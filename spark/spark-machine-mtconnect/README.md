# spark-machine-mtconnect#
A Spark Machine designed to adapt to read variable data from an mtconnect agent 'probe' request, and
query and report variable value changes from an mtconnect agent 'current' request.

The module is designed to interface as a net client, connecting to an mtconnect agent as a server.

The output from the mtconnect agent will be in an xml format.

If the data passed to this module is not in this form then the module will not work as intended and will likely sit in a constant restart loop.

The module attempts to guess the most appropriate format (data type) for each variable found e.g. float, char or int. It will also change the variable's name so that it meets with the Spark naming convention. e.g. no special characters or spaces. So for example _Top lance ht._ would become _TopLanceHt_

## Configuration

### Settings

An Enable setting for enabling/disabling the machine
An ip address for directing requests to the mtconnect agent
An optional machine name for specifying which machine to access (if the myconnect agent conencts to several machine adapters).
A timing interval for requesting the current values from the mtconnect agent.
A change-of-value-flag to indicate if the Spark Machine should ONLY report values when changed, rather than fro each request.

## Testing
In the 'test' sub-directory of the spark-machine-mtconnect directory there are two directories containing stand-alone applications to create an
mtconnect adapter and an mtconnect agent.  This agent can be used as a server for this machine's http requests.
