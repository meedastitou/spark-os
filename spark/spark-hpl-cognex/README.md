# spark-hpl-net#
A Hardware Protocol Layer (HPL) for Cognex to accept data transfer from a Cognex cvision system

The protocol will operate in a pub/sub mode, with the Spark acting as a server.  Data is assumed to be published to Spark from the physical machine.

## Current state
 - Currently only TCP (not UDP) is supported.
 - Subscribes are assumed not necessary.

## Configuration

### Variables
This module relies on being passed the contents of the configuration file of the net machine utilizing this module for it to determine which variables to deliver
to.
