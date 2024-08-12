# Spark Release Notes

<!-- toc -->

- [Spark Feature Set](#spark-feature-set)
  - [Hardware Platforms](#hardware-platforms)
  - [Machine Connectivity](#machine-connectivity)
  - [Network Connectivity](#network-connectivity)
  - [Additional Features](#additional-features)
- [Upgrading from v4 to v5](#upgrading-from-v4-to-v5)
- [Release History](#release-history)
  - [5.0.0.a14](#500a14)
  - [5.0.0.a13](#500a13)
  - [5.0.0.a12](#500a12)
  - [5.0.0.a10](#500a10)
  - [5.0.0.a09](#500a09)
  - [5.0.0.a08](#500a08)
  - [5.0.0.a07](#500a07)
  - [5.0.0.a06](#500a06)
  - [5.0.0.a05](#500a05)
  - [5.0.0.a04](#500a04)
  - [5.0.0.a03](#500a03)
  - [5.0.0.a02](#500a02)
  - [5.0.0.a01](#500a01)

<!-- tocstop -->

# Spark Feature Set

Below is a list of features supported in Spark. Newer versions of Spark include additional optimisations, code improvements, features and bug fixes. It is recommended to update to the latest version.

## Hardware Platforms

_Platform_                                                                                   | _v3_ | _v4_ | _v5_
-------------------------------------------------------------------------------------------- | ---- | ---- | ----
Intel x86-64                                                                                 | ✔    | ✔    | ✔
[Raspberry PI 3 Model B](https://www.raspberrypi.org/products/raspberry-pi-3-model-b/)       | ✔    | ✔    | ✔
[Raspberry PI 3 Model B+](https://www.raspberrypi.org/products/raspberry-pi-3-model-b-plus/) | ✔    | ✔    | ✔
[Raspberry PI 4 Model B](https://www.raspberrypi.org/products/raspberry-pi-4-model-b/)       | ✘    | ✔    | ✔

## Machine Connectivity

_Feature_                                 | _v3_ | _v4_ | _v5_
----------------------------------------- | ---- | ---- | ----
ADC (Dri-Air Dryer Controllers)           | ✘    | ✔    | ✔
Allen Bradley Ethernet                    | ✔    | ✔    | ✔
Arburg (Selogica Interace)                | ✔    | ✔    | ✔
Beckhoff ADS PLCs                         | ✔    | ✔    | ✔
Bluetooth Low Energy                      | ✔    | ✔    | ✔
Corona                                    | ✘    | ✔    | ✔
Cirrus Link Sparkplug                     | ✔    | ✔    | ✔
Cognex                                    | ✘    | ✘    | ✔
DataQ (DI-149 & DI-1110)                  | ✔    | ✔    | ✔
Euromap63                                 | ✔    | ✔    | ✔
Fanuc Roboshot LINKeye                    | ✔    | ✔    | ✔
FTP CSV processing                        | ✘    | ✘    | ✔
Keller-Bus (Serial)                       | ✘    | ✘    | ✔
Keyence Host Link (Serial & TCP)          | ✔    | ✔    | ✔
Marsilli                                  | ✘    | ✔    | ✔
Mitsubishi Fx (Serial & TCP)              | ✔    | ✔    | ✔
MLAN                                      | ✘    | ✔    | ✔
Modbus (Serial & TCP)                     | ✔    | ✔    | ✔
   Modbus (multi-client)                  | ✘    | ✘    | ✔
MTConnect                                 | ✔    | ✔    | ✔
Network (TCP/IP)                          | ✔    | ✔    | ✔
Omron (UDP Fins & Serial Hostlink)        | ✔    | ✔    | ✔
OPC-UA Client                             | ✔    | ✔    | ✔
PPT Vision                                | ✔    | ✔    | ✔
SCADA                                     | ✔    | ✔    | ✔
SECS/GEM                                  | ✘    | ✔    | ✔
SenseLinc                                 | ✘    | ✘    | ✔
Serial (RS232)                            | ✔    | ✔    | ✔
Service Request Transport Protocol (SRTP) | ✔    | ✔    | ✔
SFTP                                      | ✘    | ✘    | ✔
   Cleanlaser                             | ✘    | ✘    | ✔
   CSV                                    | ✘    | ✘    | ✔
   Folder Management (cleanup)            | ✘    | ✘    | ✔
   Text File                              | ✘    | ✘    | ✔
   XML                                    | ✘    | ✘    | ✔
Siemens S5 PLCs                           | ✔    | ✔    | ✔
Siemens S7 PLCs                           | ✔    | ✔    | ✔
Sikora                                    | ✔    | ✔    | ✔
Silvac                                    | ✘    | ✘    | ✔
SOAP                                      | ✔    | ✔    | ✔
SFTP                                      | ✘    | ✘    | ✔
USB Barcode Scanners                      | ✔    | ✔    | ✔
Wasabi                                    | ✔    | ✘    | ✘
Webdav                                    | ✘    | ✘    | ✔
   CSV                                    | ✘    | ✘    | ✔
   Text File                              | ✘    | ✘    | ✔
Yamada Dobby                              | ✔    | ✔    | ✔
Yokogawa (Serial & TCP)                   | ✔    | ✔    | ✔
Weather Sensor                            | ✘    | ✘    | ✔
Wireless Applicator Counter               | ✔    | ✔    | ✔

## Network Connectivity

_Feature_                         | _v3_ | _v4_ | _v5_
--------------------------------- | ---- | ---- | ----
Autodesk Fusion Connect           | ✘    | ✘    | ✘
AWS IoT                           | ✔    | ✔    | ✔
AWS Kinesis                       | ✔    | ✔    | ✔
Azure IoT Hub                     | ✔    | ✔    | ✔
Apache Flume                      | ✘    | ✘    | ✘
Data Logger                       | ✔    | ✔    | ✔
Google Cloud (DataStore & PubSub) | ✔    | ✔    | ✔
Grafana                           | ✘    | ✘    | ✔
MQTT client                       | ✔    | ✔    | ✔
OPC-UA Server                     | ✔    | ✔    | ✔
SQL Database                      | ✔    | ✔    | ✔
SQL Database multi-client         | ✘    | ✘    | ✔
SQL Database multi-table          | ✘    | ✘    | ✔
Sparkplug                         | ✘    | ✔    | ✔
Web sockets                       | ✔    | ✔    | ✔

## Additional Features

_Feature_                   | _v3_ | _v4_ | _v5_
--------------------------- | ---- | ---- | ----
Centralised monitoring      | ✔    | ✔    | ✔
Certificate management      | ✘    | ✔    | ✔
HTTP proxy support          | ✔    | ✔    | ✔
Machine auto-reconnect      | ✔    | ✔    | ✔
Machine Connectivity Alerts | ✔    | ✔    | ✔
Machine write-back          | ✔    | ✔    | ✔
Self monitoring             | ✔    | ✔    | ✔
Virtual variables           | ✔    | ✔    | ✔
Web Administration          | ✔    | ✔    | ✔
SNMP support                | ✘    | ✔    | ✔

# Upgrading from v4 to v5

As of v5.0.0.a04, Spark firmware is referencing the new AWS Spark Central at spark.tycoelectronics.com.
Spark devices using this firmware and forward will no longer be updated in the original Spark Central.

# Release History

## 5.0.0.a14
- SPARK-1620 - remove spark-protocol-opcua keep alive console log
- SPARK-1651 - change spark-hpl-silvac to process all unprocessed files

## 5.0.0.a13
- SPARK-1644 - update machine definition for emea-ads-tc2-bruderer-00
- SPARK-1645 - add setting to delay modbus read timer until previous response received
- SPARK-1646 - update nodes7 library to 0.3.18 for spark-hpl-siemens-s7
- SPARK-1647 - Add new Keyence req/res option to spark-hpl-serial
- SPARK-1648 - add reconnect logic to spark-hpl-silvac
- SPARK-1649 - allow spark-protocol-opcua to handle CombinedResult objects

## 5.0.0.a12
- SPARK-1561 - Update node-ble package for better packet length handling
- SPARK-1598 - Add new features to spark-machine-webdav-csv-dynamic
- SPARK-1599 - Add blacklist file option in spark-machine-webdav-txt-dynamic
- SPARK-1600 - Add additional alert reports to spark-hpl-kellerbus
- SPARK-1607 - Added hpl-modbus-multiclient to Spark
- SPARK-1608 - Add optional engineering units field to vartiable schema
- SPARK-1609 - Added machine-weather-sensor to Spark
- SPARK-1610 - Add group/offset addressing mechanism to beckhoff hpl
- SPARK-1612 - Add automatic reconnect to keyence-hostlink hpl
- SPARK-1613 - Extend timeout in modbus hpl, add mutex protection
- SPARK-1614 - Allow net hpl to return the entire received message packet
- SPARK-1616 - Improve packet processing for secs-gems hpl
- SPARK-1617 - Update libraries for google-cloud protocol
- SPARK-1618 - Add cavity properties to combined-result in aws-iot protocol
- SPARK-1620 - Add combined-result data delivery to opcua hpl
- SPARK-1621 - Add Variable-Update-Alert and SQL-reference to virtual hpl
- SPARK-1622 - Add new processing options to sql hpl
- SPARK-1623 - Add new processing options to spark-machine-ftp-csv-dynamic
- SPARK-1624 - Add new processing options to spark-hpl-webdav
- SPARK-1626 - Fix string handling in spark-protocol-opcua
- SPARK-1627 - Add certificate manager to spark-protocol-opcua
- SPARK-1628 - Add features to spark-machine-webdav-csv-dynamic
- SPARK-1629 - Add new features to spark-protocol-sql
- SPARK-1631 - Add spark-hpl-silvac
- SPARK-1632 - Add spark-hpl-cognex
- SPARK-1633 - Add new spark-hpl-sftp module
- SPARK-1634 - Add spark-hpl-sftp-xml
- SPARK-1635 - Add spark-hpl-sftp-cleanlaser
- SPARK-1637 - Add enhancements to spark-hpl-sql
- SPARK-1636 - Allow spark-hpl-sql option for multi-record-key-field as a date-time string
- SPARK-1638 - Add spark-hpl-sftp-file-cleanup
- SPARK-1639 - Add spark-protocol-sql-2
- SPARK-1640 - add spark-protocol-sql-multi-table

## 5.0.0.a10
- SPARK-1581 update release notes to include keller-bus
- SPARK-1591-fix retry mechanism for beckhoff initial network connection error
- SPARK-1592-add new event-driven SECS-GEMS data collection
- SPARK-1593-new serial option for WF818 tension controller
- SPARK-1594-add new version-2 processing for webdav-csv-dynamic
- SPARK-1595-fix machine definition editor error
- SPARK-1596-add new version-2 processing for ftp-csv-dynamic
- SPARK-1596-add ftp-csv-dynamic

## 5.0.0.a09
- SPARK-1561 - Update noble (bluetooth) library to handle unexpected packet lengths
- SPARK-1570 - Added spark-machine-webdav-csv-dynamic
- SPARK-1575 - Added spark-machine-webdav-txt-dynamic
- SPARK-1573 - Update rpi4 kernel and firmware to latest
- SPARK-1574 - Update spark-hpl-opcua to latest node-opcua library
- SPARK-1576 - Allow vision systems to deliver data on multiple cavities
- SPARK-1577 - Fix SECS-GEMS for larger variable list
- SPARK-1578 - Allow empty response files in euromap63
- SPARK-1579 - Add timestamp offset to spark-machine-webdav-txt-dynamic
- SPARK-1580 - Add time-based reporting to spark-machine-webdav-txt-dynamic
- SPARK-1581 - Add new hpl for Keller-Bus
- SPARK-1582 - Add packet-index feature to spark-hpl-net
- SPARK-1584 - Sanitize opcua received data to prevent crash
- SPARK-1585 - Add automatic reconnect for ethernet-ip protocol
- SPARK-1586 - Add auto-reconnect to hpl-secs-gems
- SPARK-1587 - Add multi-read capability to spark-hpl-beckhoff-ads

## 5.0.0.a08
- SPARK-1212 - Added Spark support for SECS-GEM protocol
- SPARK-1229 - Add test harness to Mitsubishi HPL
- SPARK-1410 - Update release notes to include Grafana output protocol
- SPARK-1432, SPARK-1433 - Add birth/death announcements into aws-advanced
- SPARK-1514 - Fix getting of alerts in deviceinfo machine
- SPARK-1516 - Add connection status to the Euromap HPL
- SPARK-1517 - If invalid filename return empty file in Euromap HPL
- SPARK-1518 - Add connection status to Omrom Fins HPL
- SPARK-1519 - Add connection status to AB Ethernet HPL
- SPARK-1520 - Add connection status to OPC-UA HPL
- SPARK-1521 - Add connection status to scanner HPL
- SPARK-1522 - Add connection status to serial HPL
- SPARK-1523 - Add connection status to SOAP HPL
- SPARK-1524 - Add connection status to Arburg HPL
- SPARK-1525 - Add connection status to Yamada Dobby HPL
- SPARK-1526 - Add connection status to Yokogawa HPL
- SPARK-1527 - Add connection status to Keyence HPL
- SPARK-1528 - Add connection status to SQL HPL
- SPARK-1531 - Add connection status to DirectNet HPL
- SPARK-1532 - Add connection status to EthernetIP HPL
- SPARK-1533 - Add connection status to SRTP HPL
- SPARK-1534 - Add connection status to Marsilli HPL
- SPARK-1535 - Add connection status to WebDAV HPL
- SPARK-1536 - Add connection status to DataQ machine
- SPARK-1539 - Add connection status to Mitsubishi HPL
- SPARK-1540 - Add connection status to BLE HPL
- SPARK-1541 - Add connection status to Modbus HPL
- SPARK-1542 - Add connection status to SECS/GEM HPL
- SPARK-1529 - Allow ternary operation in transform function
- SPARK-1530 - Fix logic for detecting invalid machine details.
- SPARK-1537 - Change SparkInfo metric to NodeInfo for sparkplug protocol
- SPARK-1538 - Remove null metadata (ex. lowLimit) from combined data delivery
- SPARK-1548 - Add new SenseLinc category under System machine definitions
- SPARK-1548 - Exempt SenseLinc machine defs from test for correct hpl
- SPARK-1549 - Add combined data delivery option to spark-hpl-dummy
- SPARK-1550 - Add nominal value reporting to otto-vision-dynamic machine
- SPARK-1552 - Add nominal value processing to spark-protocol-aws-iot
- SPARK-1553 - Fix enable-disable messaging in spark-protocol-aws-iot-advanced
- SPARK-1554 - Add datatype check in spark-protocol-opcua
- SPARK-1555 - Add isArray and arraySize to aws-iot-advanced metrics
- SPARK-1556 - Fix opcua datatype error for Variants and DataValues
- SPARK-1558 - Fix transform equation bug with spark-hpl-virtual
- SPARK-1559 - Add Kistler curve variables to the OPC-UA HPL
- SPARK-1562 - Fix checksum issue for spark-hpl-mitsubishi-fx
- SPARK-1562 - Lint syntax change
- SPARK-1563 - Fix automatic re-connect feature in spark-hpl-omron-fins
- SPARK-1564 - Add new serial parser for measurement protocol (Heidenhain)
- SPARK-1565 - Increase variable limit on siemens s7 protocol
- SPARK-1566 - Fix automatic reconnect for bad node-id response
- SPARK-1567 - Add engineering units metadata to otto-vision-dynamic
- SPARK-1568 - Change version reporting to Spark Central to allow for suffixes in -dev versions
- SPARK-1569 - Match machine name filter to allowed machine names (regex)
- SPARK-1571 - Add multi-read option to spark-hpl-beckhoff-ads

## 5.0.0.a07
- SPARK-1410 - update release notes to include Grafana output protocol
- SPARK-1491 - Include spark-protocol-aws-iot-advanced
- SPARK-1432, SPARK-1433 - add birth/death announcements into aws-advanced
- SPARK-1514 - Fix alert reporting in deviceinfo machine
- SPARK-1515 - fix unpublished variable name error
- SPARK-1517 - If invalid filename return empty file in Euromap HPL
- SPARK-1516 - Add connection status to the Euromap HPL
- SPARK-1518 - Add connection status to Omrom Fins HPL
- SPARK-1519 - Add connection status to AB Ethernet HPL
- SPARK-1520 - Add connection status to OPC-UA HPL
- SPARK-1521 - Add connection status to scanner HPL
- SPARK-1522 - Add connection status to serial HPL
- SPARK-1523 - Add connection status to SOAP HPL
- SPARK-1524 - Add connection status to Arburg HPL
- SPARK-1525 - Add connection status to Yamada Dobby HPL
- SPARK-1526 - Add connection status to Yokogawa HPL
- SPARK-1527 - Add connection status to Keyence HPL
- SPARK-1528 - Add connection status to SQL HPL
- SPARK-1531 - Add connection status to DirectNet HPL
- SPARK-1532 - Add connection status to EthernetIP HPL
- SPARK-1533 - Add connection status to SRTP HPL
- SPARK-1534 - Add connection status to Marsilli HPL
- SPARK-1535 - Add connection status to WebDAV HPL
- SPARK-1536 - Add connection status to DataQ machine
- SPARK-1539 - Add connection status to Mitsubishi HPL
- SPARK-1540 - Add connection status to BLE HPL
- SPARK-1541 - Add connection status to Modbus HPL
- SPARK-1542 - Add connection status to SECS/GEM HPL
- SPARK-1529 - Allow ternary operation in transform function
- SPARK-1530 - Fix logic for detecting invalid machine details.
- SPARK-1537 - Change SparkInfo metric to NodeInfo for sparkplug protocol
- SPARK-1538 - Remove null metadata (ex. lowLimit) from combined data delivery
- SPARK-1548 - Add new SenseLinc category under System machine definitions
- SPARK-1549 - Add combined data delivery option to spark-hpl-dummy
- SPARK-1550 - Add nominal value reporting to otto-vision-dynamic machine

## 5.0.0.a06
- SPARK-1503 Fix SQL protocol UTC adjustment
- SPARK-1507 Disable offline queueing in AWS protocol
- SPARK-1508 Remove Corona
- SPARK-1511 Double each SQL protocol insert retry time
- SPARK-1504 And instruction on how to update spark-os
- SPARK-1505 Add details on how to update spark nodejs packages
- SPARK-1506 Document creating major release branches

## 5.0.0.a05
- SPARK-1392 Add SQL protocol wide table mode
- SPARK-1498 Remove blank at end of SQL timestamp
- SPARK-1429 Add deviceinfo data for spark and machine metadata
- SPARK-1430 Implement new deviceinfo metrics in NODE BIRTH in sparkplug protocol
- SPARK-1438 Handle writting of wrong type in Modbus HPL
- SPARK-1440 Update spark to set JWT token for single-sign-on
- SPARK-1446 Fix missing unit number crash in Marsilli HPL
- SPARK-1449 Add connection status to PPT Vision Dynamic
- SPARK-1493 Add connection status to Otto Vision Dynamic
- SPARK-1494 Add connection status to net HPL
- SPARK-1495 Add connection status to Beckhoff HPL
- SPARK-1496 Add connection status to Siemens S7 HPL
- SPARK-1492 Fix machine-hpl change-of-state ignore timer operation
- SPARK-1497 Add new memory areas to Mitsubishi for FX5 protocol
- SPARK-1451 Synchronize site information between spark and spark-central
- SPARK-1502 Add a new transform operation for replace-char

## 5.0.0.a04
- SPARK-1423,1231 & 1377- Add Connection status, write-back and test-harness for spark-hpl-omron-fins
- SPARK-1424 - Add char pair swap option to Modbus HPL
- SPARK-1425 - Decrease Yokogawa HPL minimum polling time
- SPARK-1398 - Update URLs to for Spark Service in AWS

## 5.0.0.a03
- SPARK-1066 Add sparkuser account to Spark Devices - for reduced access test
- SPARK-1346 Add generic namespace to AWS protocol
- SPARK-1406 Various improvements to WebDAV HPL
- SPARK-1416 Add combined data to Beckhoff HPL
- SPARK-1417 Add override variable names to HPLs
- SPARK-1418 Normalize net HPL combined delivery
- SPARK-1420 Add combined data delivery to Modbus HPL
- SPARK-1421 Add spark release process to README.md

## 5.0.0.a02
- SPARK-1414 Revert URLs to old Spark service

## 5.0.0.a01
- SPARK-1232 Decrease function threshold for test
- SPARK-1233 Add test harness to spark-hpl-scada
- SPARK-1237 Add test harness to spark-hpl-sikora
- SPARK-1347 Add combined data delivery to AWS protocol
- SPARK-1391 Update add change type to trigger on change
- SPARK-1393 Complete test harness to spark-protocol-sql
- SPARK-1394 Reconnect serial if comm stops
- SPARK-1397 Add test harness to spark-protocol-sparkplug
- SPARK-1398 Update URLs for AWS Spark Service
- SPARK-1399 Update to node OPCUA ver 2
- SPARK-1400 Add write-back to AWS IoT protocol
- SPARK-1401 Add standard mode to spark-hpl-ethernetip
- SPARK-1402 Add onStateChangeIgnore timer to machine HPL
- SPARK-1404 Handle error when creating OPC-UA server
- SPARK-1406 Inital committ of spark-hpl-webdav
- SPARK-1407 Add OPC-UA HPL event variables
- SPARK-1408 Add change type to auto-alarm-update virtual op
- SPARK-1409 Complete test/debug of Marsilli HPL
- SPARK-1410 Initial commit of spark-protocol-grafana
- SPARK-1411 Add bitmap op to virtual HPL
- SPARK-1412 Handle undefined USB port numbers
