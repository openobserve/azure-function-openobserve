# Azure Function for sending logs to OpenObserve

Azure function to send log data from event hub to OpenObserve.

# Concept

Azure allows sending logs from any of its services through diagnostic settings. Through diagnostic settings you can configure to send logs to various destinations including event hub.

This function is designed to be used with the event hub destination. It receives the logs from the event hub and sends them to OpenObserve.

The flow looks like this:

Service (e.g. AKS, Frontdoor, etc.) sends logs via diagnostic settings -> Event Hub -> Azure Function -> OpenObserve



