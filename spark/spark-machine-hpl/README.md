# Spark Machine HPL
Generic Spark machine to handle Hardware Protocol Layer (HPL) enabled machines.  spark-machine-hpl searches for machines defined by a JSON file and chooses the correct HPL for the machine.  spark-machine-hpl search for JSON files based on the MACHINE_DIRS environment variable.

JSON files must comply to the based HPL JSON schema defined in schemas/hpl.json and to the JSON schemas defined by the individual HPL in use my the machine.

## Configuration

**Environment Variable** | **Meaning**
------------------------ | ---------------------------------------------------------------
MACHINE_DIRS             | Comma separated list of directories to search in priority order


## Optional Post Processing
This base HPL is resposible for writing all the data from each HPL, before writing these values it can apply some post processing to each variable.

Post Processing types

- average a number of source variable values
- downsample a source variables values
- produce values only when source variables go outside defined thresholds
- produce values only when a source variable changes
- transform the source variables values using an equation
- transform the source variables values by mapping to other values

The following table describes the fields of each variable

Field       | Description
----------- | ------------------------------------------------------------------------------------------------
onChange | If set to true, only values that have changed will be created.
averageLength |  In 'Average' mode, the number of source samples to average before creating a new value from the average.
downsampleSize | In 'Downsample' mode, the number of source samples to skip before creating a new value.
thresholdLower | The lower threshold of the 'good' bounds. Only source values lower than this will create new values.
thresholdUpper | The upper threshold of the 'good' bounds. Only source values higher than this will create new values.
transformEq | Optional equation to transform the variable.  Use the letter x to represent the variable in the equation.  Depending on the transformation applied it may be necessary to also set outputFormat. For example, x/10 may change an int16 to the outputFormat float.
transformMap | Optional map to apply to the variable.  For example, use this to transform 1 to 'success' or 'not found' to 404.  Depending on the transformation applied it may be necessary to also set outputFormat.  For example, to transform 1 to \"success\" would require outputFormat to be char.

Note, some modes of post processing like averaging and thresholds do not currently support source variable data that are arrays of values.

Note, both transformEq and transformMap processing can be applied after one of the other processing modes, but only one of, averaging, downsampling, onchange and threshold processing can be done at once.

# Authors
[Martin Bark](mailto:martin.bark@te.com)
