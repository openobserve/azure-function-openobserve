const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

/********* Calculate time taken to send the request starts */
axios.interceptors.request.use(function (config) {
    config.metadata = { startTime: new Date() }
    return config;
}, function (error) {
    return Promise.reject(error);
});

axios.interceptors.response.use(function (response) {
    response.config.metadata.endTime = new Date()
    response.duration = response.config.metadata.endTime - response.config.metadata.startTime
    return response;
}, function (error) {
    error.config.metadata.endTime = new Date();
    error.duration = error.config.metadata.endTime - error.config.metadata.startTime;
    return Promise.reject(error);
});
/********* Calculate time taken to send the request ends */

module.exports = async function (context, eventHubMessages) {
    // context.log(`JavaScript eventhub trigger function called for message array: ${eventHubMessages}`);

    /************* connection details start *************/
    // You can get these connection details from OpenObserve UI > Ingestion > Logs > Azure

    let api_endpoint = "https://api.openobserve.ai/api/"
    let org = "<your organization>" //e.g. "prabhat_organization_435"
    // Define Basic Authentication credentials
    let auth = {
        username: '<your email id>',    // replace with your username (generally your email address) e.g. you@yourcompany.com
        password: '<password>'    // replace with your password e.g. T246s652dg5q0sFvBui
    };
    /************* connection details end *************/

    
    let org_url = api_endpoint + org;

    let log_stream_prefix = 'az_logs';

    let metric_stream_name = 'az_metrics';
    let metric_url = org_url + '/' + metric_stream_name + '/_json';

    // Iterating through all messages
    // Convert all send_data calls to Promises and wait for all of them to complete before finishing the function
    await Promise.all(eventHubMessages.map(async (message, index) => {
        let records = JSON.parse(message).records;
        let log_records = {};
        log_records['default'] = [];
        let metric_records = [];

        records.forEach((record, index) => {
            record._timestamp = record.time; // Add the _timestamp field to the record. _timestamp is the field that is used by OpenObserve timestamping
            delete record.time; // Remove the time field from the record. No need to have it twice

            // If there is a log field in the record, then it is a log record
            if (record && record.properties && record.properties.log) { // AKS logs are available in the log properties field
                // parse the text as JSON if its JSON text else leave it alone
                try {
                    record.properties.log = JSON.parse(record.properties.log);
                    if (!log_records[record.category]) {
                        log_records[record.category] = [];
                    }
                    log_records[record.category].push(record);
                }
                catch (e) {
                    if (!log_records[record.category]) {
                        log_records[record.category] = [];
                    }
                    log_records[record.category].push(record); // if it is not JSON, then leave it alone
                }
            } else if (record && record.metricName) {   // metrics have a metricName field
                metric_records.push(record);
            } else if (record && record.properties) {    // if it is neither an AKS log nor a metric, then it is a different type of record. App insights has logs in properties field
                try {
                    record.properties = JSON.parse(record.properties); // parse the text as JSON if its JSON text else leave it alone
                    if (!log_records[record.category]) {
                        log_records[record.category] = [];
                    }
                    log_records[record.category].push(record);
                }
                catch (e) {
                    if (!log_records[record.category]) {
                        log_records[record.category] = [];
                    }
                    log_records[record.category].push(record); // if it is not JSON, then leave it alone
                }
                context.log("Log record with properties found");
            } else {
                if (!log_records[record.category]) {
                    log_records[record.category] = [];
                }
                log_records['default'].push(record);
                context.log("Different type of record found:", JSON.stringify(record));
            }
        })

        // Iterate through all log streams and send the records to the corresponding log stream
        const log_promises = Object.keys(log_records).map((stream) => {
            let url = org_url + '/' + log_stream_prefix + "_" + stream + '/_json';
            return send_data(context, url, log_records[stream], auth);
        });

        await Promise.all(log_promises); // send all log records and wait for all of them to complete before continuing

        await send_data(context, metric_url, metric_records, auth); // send all metric records

    })).then(() => {
        context.log(`All records processed`);
    });

};

// send_data with exponential backoff
async function send_data(context, url, records, auth) {
    if (records.length === 0) {
        return;
    }

    const maxRetries = 5;
    let delayMs = 1000; // Initial delay in milliseconds

    let ingestion_id = uuidv4();
    url = url + '?ingestion_id=' + ingestion_id;

    // add ingestion id to every record in the records array for debugging purposes
    records.forEach((record, index) => {
        record.ingestion_id = ingestion_id;
    })

    context.log(`Sending ${records.length} records to ${url}`);

    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await axios.post(url, records, { auth: auth });
            context.log(`${records.length} records sent successfully in ${response.duration}ms. Response status: ${response.status}`);
            return; // If the request is successful, we return from the function
        } catch (error) {
            context.log(`Attempt ${i + 1} failed to send ${records.length} records to ${url}. Error: ${error}`);
            if (error.response && error.response.status >= 400 && error.response.status < 500) {
                context.log(`Not retrying because received 4xx error`);
                break;
            }
            if (i < maxRetries - 1) { // If this is not the last retry
                context.log(`Retrying to send ${records.length} records after delay of ${delayMs}ms`);
                await new Promise(resolve => setTimeout(resolve, delayMs)); // Add delay before retrying
                delayMs *= 2; // Double the delay for the next iteration. Exponential backoff
            } else {
                context.log(`Max retries reached to send ${records.length} records. Giving up.`);
            }
        }
    }
}

