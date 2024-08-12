# spark-machine-ppt-vision-dynamic#
A Spark Machine designed to adapt to dynamically changing variable data from a WebDAV txt system.

The module is designed to interface as a WebDAV client, wathcing for new txt files to process for data.

The txt file output must match the format:
Width1=3369 Height1=582 Angle1=1210 LeftWing_1_Width=180
Width2=3375 Height2=523 Angle2=1129 RightWing_2_Width =175 Distance=4321 1/21/2021 09:00:03:000
Width1=3374 Height1=158 Angle1=600 LeftWing_1_Width=158
Width2=3371 Height2=158 Angle2=1460 RightWing_2_Width =157 Distance=4342 1/21/2021 09:00:03:000
Width1=3377 Height1=178 Angle1=629 LeftWing_1_Width=217
Width2=3371 Height2=524 Angle2=1419 RightWing_2_Width =176 Distance=4342 1/21/2021 09:00:04:000

If the data passed to this module is not in this form then the module will not work as intended and will likely sit in a constant restart loop.

The module attempts to guess the most appropriate format (data type) for each variable found e.g. float, char or int. It will also change the variable's name so that it meets with the Spark naming convention. e.g. no special characters or spaces. So for example _Top lance ht._ would become _TopLanceHt_

## Configuration

### Settings

## Testing
