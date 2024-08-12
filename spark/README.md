# Spark

<!-- toc -->

- [Git](#git)
  - [Check out](#check-out)
  - [Updating](#updating)
  - [Push](#push)
- [Spark Release Process](#spark-release-process)
  - [Create JIRA task](#create-jira-task)
  - [Set the version number](#set-the-version-number)
  - [Generate the release info](#generate-the-release-info)
  - [Update watchers list in JIRA](#update-watchers-list-in-jira)
  - [Update release notes](#update-release-notes)
  - [Prepare the JIRA Comment](#prepare-the-jira-comment)
  - [Push changes](#push-changes)
  - [Building the release](#building-the-release)
  - [Download the release](#download-the-release)
  - [Upload to OneDrive](#upload-to-onedrive)
  - [Upload to Spark Service](#upload-to-spark-service)
  - [Moving from Beta to Production](#moving-from-beta-to-production)
  - [Update to a development version](#update-to-a-development-version)
  - [Update JIRA](#update-jira)
  - [More releases](#more-releases)
  - [Done](#done)
- [Updating Spark Node.js Packages](#updating-spark-nodejs-packages)

<!-- tocstop -->

# Git

## Check out

Since this repository uses submodules it should be checked out as follows

```
git clone --recursive https://makemake.tycoelectronics.com/stash/scm/iotlabs/spark.git
```

The submodule will be on a detached HEAD which is fine to build a release but for development work it is necessary to checkout the correct branch. This can be automated as follows:

```
git submodule foreach -q 'git checkout $(git config -f $toplevel/.gitmodules submodule.$name.branch || echo master)'
```

## Updating

The recommneded way to update a clone of this repository during development is as follows:

```
git pull
git submodule update --init --recursive
git submodule foreach -q 'git checkout $(git config -f $toplevel/.gitmodules submodule.$name.branch || echo master)'
git submodule foreach git pull
```

## Push

To push a change to a submodule first you need to move to the correct branch then push as normal. For example

```
cd spark-logging
<edit some files>
git commit
git push
```

Next the spark repository needs to be updated to track the update to the submodule

```
cd ..
git commit
git push
```

# Spark Release Process

## Create JIRA task

Create a new [JIRA](https://makemake.tycoelectronics.com/jira/secure/RapidBoard.jspa?projectKey=SPARK) task titled _End of spark sprint xx release_ where `xx` is the current active sprint number. Make sure the task is in the current active sprint and is of type `Task`. Mark the new JIRA task as active and make note of the JIRA number.

## Set the version number

First edit the spark version number in [spark-os/spark/release][1] Remove the `-dev` tag from the end of the version number. Save and exit the editor. Next add and commit the change

```
git add spark/release
git commit -sm "SPARK-xxx update version to yyy"
```

Where `xxx` is the JIRA task we created and `yyy` is the version number from [spark-os/spark/release][1]. Check the commit we just made to see all is OK using `git show`. Make sure the version number in the commit message and the contents of [spark-os/spark/release][1] match.

## Generate the release info

Run the `./gen-release-info` script in the top level spark directory. You will see an output similar to this

```
Hi,

I have created a [1.2.3.a04|https://te360.sharepoint.com/sites/SparkDev/Shared%20Documents/General/spark-releases-dev/1.2.3.a04] release of Spark. This is an *Alpha* release of the v5.x (master) branch and must not be used in production. This release includes:

# SPARK-100 Add new special feature
# SPARK-101 Fix some major bug
# SPARK-102 Add new test

Please download the [1.2.3.a04|https://te360.sharepoint.com/sites/SparkDev/Shared%20Documents/General/spark-releases-dev/1.2.3.a04] release from the [spark-releases-dev|https://te360.sharepoint.com/sites/SparkDev/Shared%20Documents/General/spark-releases-dev] folder. The release includes the following files:

# Release_Notes.pdf - Spark Release notes
# Installation_Manual.pdf - Installation and setup instructions
# Development_Environment_Setup.pdf - Details on setting up an environment to develop code for Spark
# Adding_A_Hardware_Protocol_Layer.pdf - How to add a new HPL
# Adding_A_Protocol_Layer.pdf - How to add a new protocol
# spark_rpi3_1.2.3.a04.zip - Raspberry Pi 3 firmware
# spark_rpi3_1.2.3.a04_sdcard.img.zip - Raspberry Pi 3 sd card image for initial setup
# spark_rpi4_1.2.3.a04.zip - Raspberry Pi 4 firmware
# spark_rpi4_1.2.3.a04_sdcard.img.zip - Raspberry Pi 4 sd card image for initial setup
# spark_x86_64_1.2.3.a04.zip - x86-64 firmware (Advantech ARK-1123C)
# spark_x86_64_1.2.3.a04_sdcard.img.zip - x86-64 sd card image for initial setup (Advantech ARK-1123C)

Note: you should see the [spark-releases-dev|https://te360.sharepoint.com/sites/SparkDev/Shared%20Documents/General/spark-releases-dev] folder under your “Shared with me” folder in the OneDrive web interface. You can access OneDrive via https://portal.office.com or click on the links above.

The source code can be found in the [spark|https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark] repository under the [v1.2.3.a04|https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark/browse?at=refs%2Ftags%2Fv1.2.3.a04] tag.

Thanks

[~TE192191]

Watchers:
TE1234, TE5678, TE8910

Manually edit then add the following to RELEASE_NOTES.md

# Release History

## 1.2.3.a04

* SPARK-100 Add new special feature
* SPARK-101 Fix some major bug
* SPARK-102 Add new test
```

Copy and paste this text into an editor for future reference

## Update watchers list in JIRA

Go back to the JIRA task and update the watches list to match the output from `./gen-release-info`. To edit the watchers list click More -> Watchers in the JIRA task.

## Update release notes

Edit [spark-manual/src/doc/Release_Notes.md][2] and add a new entry to the `Release History` section. You should paste the text output from `./gen-release-info` for the Release History. When adding the Release History consider the following:

1. Edit the list to remove any duplicate entries. There should only be on entry for each SPARK-xxx line
2. Correct any typing or spelling mistakes in the commit messages
3. Remember that the list should start with a dash `-` character to make a list.

Save the changes. Now update the table of contents and commit the changes

```
cd spark-manual
yarn install
yarn updatetoc
git add src/doc/Release_Notes.md
git commit -sm "SPARK-xxx Update release notes for yyy release"
```

Where `xxx` is the JIRA task we created and `yyy` is the spark version number. Check the commit we just made to see all is OK using `git show`. Make sure the version number in the commit message and the contents of [spark-manual/src/doc/Release_Notes.md][2] match. Also make sure a new entry in the table of contents was added.

## Prepare the JIRA Comment

Copy the text from the output of `./gen-release-info` into an text editor ready for later adding the JIRA. Do not add this comment to the JIRA task yet. First you need to correct the list of SPARK-xxx JIRA tasks in the message to match any updates you made to [Release_Notes.md][2]. Keep this text in the editor ready for later use.

## Push changes

Run the following command to commit the changes to `spark-os` and `spark-manual`. Run `git show` one last time to make sure all is OK. If you spot a mistake this is your last opportunity to fix it.

```
cd spark-os
git show
git push
cd ../spark-manual
git show
git push
cd ..
git add spark-manual spark-os
git commit -sm "SPARK-xxx update version to xxxx"
git push
```

Where `xxx` is the JIRA task we created and `yyy` is the spark version number. Assuming the code all pushed successfully next we need to tag the release

```
git tag yyy
git push --tags
```

The version number in the tag should start with a latter `v` . For example `git tag v1.2.3`.

## Building the release

Go to [Jenkins](https://cmb-jenkins.gb.tycoelectronics.com/job/spark/) and manually start the build. Now wait for the build to complete.

## Download the release

Go back to [Jenkins](https://cmb-jenkins.gb.tycoelectronics.com/job/spark/)

1. click on the build version e.g. `master`
2. Under the `Last Successful Artifacts` section check the filename look OK. They should have the correct version umber in their name.
3. click the `Last Successful Artifacts` button
4. click `(all files in zip)` to download a zip of all the files
5. Go to where you downloaded the release on your computer and extract the zip file

Open `Release_Notes.pdf` and check the contents look correct and includes the changes you made

## Upload to OneDrive

> Note: Only upload to OneDrive using the webpage, the desktop client is not reliable at this

1. Got to <https://portal.office.com/>
2. Click the OneDrive icon
3. Wait for the page to fully load. On the left side click the "Spark Developer" icon
4. Select `Documents` then `General`
5. For all alpha and beta releases open the `spark-release-dev` folder. For production releases open the `spark-releases` folder
6. Inside the folder create a new directory that matches the spark version number
7. open the new directory
8. click `Upload` and select all the files we download from Jenkins

Wait for the upload to complete

## Upload to Spark Service

> Note: Only do this step for production releases

1. go to the [Spark Service](https://spkappd01.tycoelectronics.net/) webpage
2. Select Releases
3. Upload the firmware files we download from Jenkins

Once all the firmware has upload updating the firmware on your own test spark.

> Note: If the update fails do not release the firmware. Depending on the issue you should consider deleting the Release you just uploaded.

## Moving from Beta to Production

> Note: This step is only necessary when taking a release from beta to a the first production release

When making major release and moving from beta into production you should additionally create a branch to hold the new stable release on.  For example, if we moved from `5.0.0.b04` to `5.0.0` the following steps need to happen

1. release `5.0.0`
2. create a `v5.x` branch based off the `5.0.0` release tag.  This branch is from maintenance of the `v5.x` code base.
2. the master branch will become `6.0.0.a01-dev`
4. update the code on `v5.x` branch to `5.0.1-dev`

The following is an example of releases `5.0.0` and creating a `v5.x` branch.  Adjust the version number according to your major release.

Once the `5.0.0` release has succeeded create a `v5.x` branch as follows:
1. Type `git log` and confirm the current checkout is the tagged `5.0.0` release
2. Type `git checkout -b v5.x` to create a `v5.x` branch locally and move to that branch.  You are now on the `v5.x` branch
3. Type `git submodule foreach git checkout -b v5.x` to create `v5.x` branches in all the submodules
4. Type `git push --set-upstream origin v5.x` to push the new branch to the server.  At this point we have pushed an empty branch.
5. Type `git submodule foreach git push --set-upstream origin v5.x` to push the `v5.x` branch to the modules
6. Update the branch we use for the submodule by typeing `sed -i 's/branch =.*/branch = v5.x/' .gitmodules` then `git add .gitmodules` to add the change locally
7. Continue with the step below to [Update to a development version](#update-to-a-development-version) and update the version to `5.0.1-dev`.  Commit the changes to `.gitmodules` as part of the update to the version number to `5.0.1-dev`.

At this point you have created the `v5.x` branch and updated it to `v5.x`.  Next you need to go back to the master branch to update to `6.0.0.a01-dev`

1. Type `git checkout master` to move back to the master branch
2. Type `git submodule foreach -q 'git checkout $(git config -f $toplevel/.gitmodules submodule.$name.branch || echo master)'` to move all the submodules back to the master branch
3. Continue with the step below to [Update to a development version](#update-to-a-development-version) and update the version to `6.0.0.a01-dev` as in a normal release.

## Update to a development version

If you are moving from alpha to beta or beta to production you should edit `release-template.txt`.  Change the line that says "This is an *Alpha* release of the v5.x (master) branch and must not be used in production" according to the new release type.

The text should say
- For alpha releases: "This is an *Alpha* release of the v6.x (master) branch and must not be used in production"
- For beta releases: "This is an *Beta* release of the v6.x (master) branch and must not be used in production"
- For production releases this warning can be removed from `release-template.txt`

When moving from beta to production also edit the links to OneDrive from `spark-releases-dev` to `spark-releases-dev`.  Once you have updated `release-template.txt` the type `git add release-template.txt`

Edit the spark version number in [spark-os/spark/release][1] again and this time increment the version number and make sure to add `-dev` back on. For example if the version was `1.2.3.a04` your would set the version to `1.2.3.a05-dev`.

Save the file and commit the change

```
git add spark/release
git commit -sm "SPARK-xxx update version to yyy"
```

Where `xxx` is the JIRA task we created and `yyy` is the new `-dev` version number we just set in [spark-os/spark/release][1]. Check the commit we just made to see all is OK using `git show`. Next commit the change

```
git push
cd ../
git add spark-os
git commit -sm "SPARK-xxx update version to yyy"
git push
```

## Update JIRA

Copy the JIRA comment we prepared earlier and add it to the JIRA task. Save the comment.

## More releases

If you have more releases to do as part of this sprint repeat this process for each spark release you are making. Once all the spark releases are made close the JIRA comment.

## Done

Congratulations you have released spark.

# Updating Spark Node.js Packages

From time to time it is advisable to update the nodejs packages. Reasons to update include:

1. upstream bug fixes and optimisations
2. support newer version of nodejs
3. new features

Difficulties in updating include:

1. Packages becoming obsolete or unmaintained resulting in errors
2. changes to apis

If packages become obsolete or unmaintained you may need to switch to a new packages. Packages will normally document breaking changes to APIs ad advise on how to migrate. Running the test harnesses for a module will normally show up issues dues to API changes.

The following steps should be taken to update spark nodejs packages:

1. make sure the development machine is running the correct nodejs version. Ideally this should match the version used by spark-os. In the following example we assume spark-os is being updated to nodejs v12.16.1 and hence spark packages need updating.

2. Run the `./update` script. This will use `yarn` to update the `package.json` and `yarn.lock` files to packages latest versions.  If will also update any `Dockerfile` to match the current version of nodejs

> Note: this step may take a long time to complete

3. Fix any lint errors there may have arisen due to the update

4. Run `make test` and fix any issues


[1]: spark-os/spark/release
[2]: spark-manual/src/doc/Release_Notes.md
