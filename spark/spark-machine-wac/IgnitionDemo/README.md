# Ignition Dashboard Guide #

## Requirements: ##

Some experience of using and creating dashboards with Ignition Designer is needed for this. Ignition can be downloaded and installed here: https://inductiveautomation.com/downloads/ignition

Pro tip: To avoid having to register, you can just right click the download link and select "Save Link As" and it will download automatically!

N.B: The downloaded version is a trial version which lasts for two hours. At the end of the period, you can reset the trial in the web control page for another two hours of use.

If you're not used Ignition before, Inductive has a comprehensive series of video tutorials that can help get you started here:
https://inductiveuniversity.com/courses/all

This guide also makes use of some SQL queries and Python scripting, though all the required code is provided.

Documentation for the Python scripting functions and expressions, as well as documentation of the various components available in the designer can be found here:
https://support.inductiveautomation.com/usermanuals/ignition/index.html?welcome_topic.htm

For more on SQL expressions, w3schools has a good tutorial as well:   
https://www.w3schools.com/sql/default.asp

## Linking Spark and Ignition ##
To link Ignition to a Spark, you must first set up Spark to use the OPC-UA Server ouput protocol. In the Spark WebAdmin, go to the 'Protocols' frame and select "OPC-UA Server". Make a note of the 'OPC-UA listen port' that shows up.

Now we need to go to the Ignition webpage, which is typically at localhost:8080/main/web/home. Click the 'Configure' tab at the top an then look for the 'OPC Connections' heading in the left hand frame. Under this, click 'Servers'. By default, Ignition will have one extant connection, "Ignition OPC-UA Server". We want to add another however. To do this, click "Create new OPC Server Connection", then choose the first option ("OPC-UA").

![opcua type.png](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-wac/browse/IgnitionDemo/Ignition%20Setup%20Guide%20Images/opcua%20type.png?at=d7bdc6314bb27ba933dea05f0200b4b62a8a7edb&raw)

Click 'Next', and you will get to a screen that says "Discover OPC-UA Endpoints". In the text box, enter the following and click the 'Discover' button:

```
opc.tcp:// [Your Spark's IP address] : [the OPC-UA listen port from the WebAdmin]
```

You will now be presented with a range of security options. For demo purposes, no security is really required, so select the first option:

![discover opc endpoints.png](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-wac/browse/IgnitionDemo/Ignition%20Setup%20Guide%20Images/discover%20opc%20endpoints.png?at=d7bdc6314bb27ba933dea05f0200b4b62a8a7edb&raw)

Click the 'Next' button and name the OPC-UA connection (e.g. 'SparkDemo') and then leave all the other settings as they are. Click the "Create New OPC Server Connection" button at the bottom and you should see your connection added to the list!

## Adding OPC-UA Tags in Ignition ##
Tags are an integral part of Ignition, allowing you to get data from an OPC-UA server and do something with it. Luckily, it's quite easy to get using them. To add a new tag, look for the 'Tag Browser' window on the mid-left hand side of the Ignition Designer application and click the 'OPC' button:

![tag browser opc.png](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-wac/browse/IgnitionDemo/Ignition%20Setup%20Guide%20Images/tag%20browser%20opc.png?at=d7bdc6314bb27ba933dea05f0200b4b62a8a7edb&raw)

This will bring up a window called 'OPC Browser'. In this, you should see your Spark appear. If you expand the options, you should see a list of folders, including any enabled machines. To add a tag or tags for your desired machine, expand the folder and select then drag and drop the tags you want onto the 'Tags' folder in the 'Tag Browser' window.

![selected tags.png](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-wac/browse/IgnitionDemo/Ignition%20Setup%20Guide%20Images/selected%20tags.png?at=d7bdc6314bb27ba933dea05f0200b4b62a8a7edb&raw)

This will bring up a window called 'OPC Browser'. In this, you should see your Spark appear. If you expand the options, you should see a list of folders, including any enabled machines. To add a tag or tags for your desired machine, expand the folder and select then drag and drop the tags you want onto the 'Tags' folder in the 'Tag Browser' window.

For better organisation, you can create folders for groups of tags in the 'Tag Browser' window, and it might be useful to do this on a machine basis (i.e. group the tags for each machine).

To use the tags, simply drag the tag to a given component to have that component get data from the tag!

## Ignition & MySQL: ##

It can be useful to store data from devices in a database for later use, or, for example, if you wish to plot a graph of the data. Ignition provides good functionality for interacting with SQL databases, and so that's what this guide will use.

The first step is to download the version of MySQL Workbench appropriate to your system. The latest versions are available here:
https://dev.mysql.com/downloads/workbench/

Follow the installation guide here to get it set up: http://www.mysqltutorial.org/install-mysql/

This guide will use the Wireless Applicator Counter (WAC) as an example device. You may need to alter certain things (e.g. table columns)
to suit your application/device.

### Creating a New Database ###

A new connection must first be created. Click the small '+' icon in the homescreen and the following window will appear:

![New SQL Connection.png](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-wac/browse/IgnitionDemo/Ignition%20Setup%20Guide%20Images/New%20SQL%20Connection.png?at=d7bdc6314bb27ba933dea05f0200b4b62a8a7edb&raw)

Give the connection a suitable name, e.g. 'ignitiondemo' and keep the default connection method, hostname and port settings.

You should then see blank query screen. You can now begin creating the database. Enter the following query:

```
CREATE DATABASE wac_data;
```

Now click the small lightning bolt icon to run the query.

The database must be selected in order to use it. Remove the last query from the window and enter the following,
again clicking the lightning bolt to run it.

```
USE wac_data;
```

Your database should now be set up for use! To store data, you'll need to create a table, which is again achieved using the 'create'
keyword.

On the left hand side, you'll see a section that says "Schemas". Click the small refresh icon and your newly created database should
appear!

When creating a table, it's worth deciding which data you want to store to avoid having to append it later. For the counts recorded
by WACs, three columns representing three sets of data will be used.

The first is a way to uniquely identify the data for a given device. Each WAC has a unique serial number, so we'll call this column
'serial_num'. The next column will be a timestamp of when the data was recorded, so this column will be called 'date'. The final
column will be the data itself, so we'll call it 'count'.

You will also need to consider the datatype of each column to avoid problems with Ignition tags later on. serial_num is an integer
number, so we'll give it the type 'INT'. Date is a 'datetime' object and so we'll give it this type as well. Lastly, 'count' is
also an integer number so we'll make this an integer.

To create a new table with three columns and types, the following query is used:

```
CREATE TABLE wac_count(serial_num INTEGER, date DATETIME, count INTEGER);
```

Again, run this query and click the refresh icon by 'schemas', and your new table should appear as such:

![schemas.png](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-wac/browse/IgnitionDemo/Ignition%20Setup%20Guide%20Images/schemas.png?at=d7bdc6314bb27ba933dea05f0200b4b62a8a7edb&raw)


To check your table has been created correctly, the following query can be used to select everything in the table:

```
SELECT * FROM wac_count;
```

If the previous steps were completed correctly, you should see an empty table as follows:

![empty table and log.png](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-wac/browse/IgnitionDemo/Ignition%20Setup%20Guide%20Images/empty%20table%20and%20log.png?at=d7bdc6314bb27ba933dea05f0200b4b62a8a7edb&raw)

### Using your Database with Ignition: ###

#### Setting up an Ignition Database Connection ####
For Ignition to see your database, you must first add it to the list of database connections in the online dashboard. To access this, go to the Ignition webpage and click the 'Configure' tab. On the left hand side, there should be a list of options. Under 'Databases', click the 'Connections' option:

![database connections.png](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-wac/browse/IgnitionDemo/Ignition%20Setup%20Guide%20Images/database%20connections.png?at=d7bdc6314bb27ba933dea05f0200b4b62a8a7edb&raw)

Now, click "Create new Database Connection...", and choose "MySQL ConnectorJ". You will be brought to a screen that allows you to specify settings for the database connection.

Give your connection a sensible name, and a description if you wish, and also make sure the 'Connect URL' points to the settings specified when you set up the SQL database in MySQL workbench. You will also need to enter the username and password you had for MySQL.

![setup database connection.png](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-wac/browse/IgnitionDemo/Ignition%20Setup%20Guide%20Images/setup%20database%20connection.png?at=d7bdc6314bb27ba933dea05f0200b4b62a8a7edb&raw)

Leave the other settings as they are and click the "Create New Database Connection" button at the bottom of the screen. If all is well, your database should appear in the list of database connections!

![successful db connection.png](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-wac/browse/IgnitionDemo/Ignition%20Setup%20Guide%20Images/successful%20db%20connection.png?at=d7bdc6314bb27ba933dea05f0200b4b62a8a7edb&raw)

Leave the other settings as they are and click the "Create New Database Connection" button at the bottom of the screen. If all is well, your database should appear in the list of database connections!

#### Writing to the Database from Ignition ####
To append data to your database, you must add a script to the corresponding data tag in Ignition. To do this, first select the tag corresponding to the data you wish to use and click 'edit tag'. In this example, we'll use '000e5b001510-count'.

![edit tag.png](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-wac/browse/IgnitionDemo/Ignition%20Setup%20Guide%20Images/edit%20tag.png?at=d7bdc6314bb27ba933dea05f0200b4b62a8a7edb&raw)

In the 'Tag Editor' window, select the option that says 'Tag Events', and select the 'Value Changed event'. This will bring up a small window where you can enter a Python (technically Jython, as Ignition is written in Java) script.

![valuechanged.png](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-wac/browse/IgnitionDemo/Ignition%20Setup%20Guide%20Images/valuechanged.png?at=d7bdc6314bb27ba933dea05f0200b4b62a8a7edb&raw)

In the 'Tag Editor' window, select the option that says 'Tag Events', and select the 'Value Changed event'. This will bring up a small window where you can enter a Python (technically Jython, as Ignition is written in Java) script.

For our example, we want to write data corresponding to each column of the database; a serial number, a date and a count. The following script does that:

```
from datetime import datetime

#Serial number -unique identifier for a given device
serial = int(system.tag.read("/wac1/000e5b001510-serialNum").value)

#The time the change/count was recorded
times = datetime.now()

#The value to be written
count = int(system.tag.read("/wac1/000e5b001510-count").value)

#Insert a new row
system.db.runUpdateQuery("INSERT INTO wac_count(serial_no, date, count) " + "VALUES('%d', '%s', '%d')" %(serial, times, count), 'wac_data') # date_count table
```
Note that Python uses tabs to determine where in the code you are, so be aware of how your script is tabbed! The above should all be in line, as show, and all tabbed to one indent from the left.

Now, whenever a change in the value of the tag is detected, the latest value will be written to the database!

#### Retrieving Data from the Database ####
Now that you have data in the database, you'll likely want to do something with it! Certain components in Ignition Designer allow you to provide them data from a database. Continuing our example of the WAC, we're going to create a graph which displays the count of a WAC over time.

Scroll down to the 'Charts' section of the 'Component Palette' window and drag a standard 'Chart' component into your window:

![select chart.png](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-wac/browse/IgnitionDemo/Ignition%20Setup%20Guide%20Images/select%20chart.png?at=d7bdc6314bb27ba933dea05f0200b4b62a8a7edb&raw)

You will see it has been populated with some data already. This is pretty useless to us however, we want to use our own data! At the bottom left of the designer application, there should be a 'Property Editor' window. Under 'Custom Properties', you should see a cell that says 'Data'. Click the icon furthest to the right:

![data icon.png](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-wac/browse/IgnitionDemo/Ignition%20Setup%20Guide%20Images/data%20icon.png?at=d7bdc6314bb27ba933dea05f0200b4b62a8a7edb&raw)

You will see it has been populated with some data already. This is pretty useless to us however, we want to use our own data! At the bottom left of the designer application, there should be a 'Property Editor' window. Under 'Custom Properties', you should see a cell that says 'Data'. Click the icon furthest to the right:

This should bring up a window with a heading that says: "Property Binding: Root Container.Chart". On the left hand side of this, under the 'Database' heading, select SQL query. here, you can enter an SQL query just like those we used when setting up the database. As we want to retrieve data, we will be using a variation on the "SELECT * FROM wac_count" query we saw before.

As we want to plot specific data, we will need to select the columns corresponding to that data. In addition, we want to choose the data for a specific device. This can be achieved by using a query of the following form:

```
SELECT column, another_column FROM table_name WHERE a_further_colum = value
```
For our example of plotting the count against the date for a specific WAC, the following query is used:

```
SELECT date, count FROM wac_count WHERE serial_num = {wac1/000e5b001510-serialNum}
```
**N.B: THE ORDER OF YOUR QUERY IS IMPORTANT! HERE, DATE IS THE X-AXIS AND COUNT IS THE Y-AXIS, AND SO YOU _MUST_ QUERY THEM IN THAT ORDER.**

The condition 'serial_num = {wac1/000e5b001510-serialNum}' means you don't need to know the serial number in advance and hard code it -you can get it from the OPC-UA tag! This is done by clicking the tag icon to the right of the scripting window and choosing the relevant tag:

![sql query dynamic tag.png](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-wac/browse/IgnitionDemo/Ignition%20Setup%20Guide%20Images/sql%20query%20dynamic%20tag.png?at=d7bdc6314bb27ba933dea05f0200b4b62a8a7edb&raw)

If you have your Spark running and collecting data, and provided everything has been done correctly, you should see your graph start plotting!

![filled graph.png](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-wac/browse/IgnitionDemo/Ignition%20Setup%20Guide%20Images/filled%20graph.png?at=d7bdc6314bb27ba933dea05f0200b4b62a8a7edb&raw)
