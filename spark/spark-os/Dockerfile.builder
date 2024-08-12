FROM node:8.15.1

ARG uid=1000
ARG gid=1000

# change deb.debian.org to archive.debian.org
RUN echo "deb http://archive.debian.org/debian stretch main" > /etc/apt/sources.list

# Install packages
RUN apt-get update && apt-get install -y \
      bash-completion \
      bc \
      bison \
      build-essential \
      cmake \
      cpio \
      flex \
      gcc-multilib \
      gettext \
      git \
      libelf-dev \
      libssl-dev \
      locales \
      rsync \
      sudo \
      unzip \
      vim \
    && rm -rf /var/lib/apt/lists/*

# Install the license-checker
RUN npm install -g license-checker

# Create a downloads directory
RUN mkdir -p /dl
ENV BR2_DL_DIR /dl

# Add a sparkadmin user
RUN userdel -r node
RUN groupadd -g ${gid} sparkadmin
RUN useradd -ms /bin/bash -u ${uid} -g ${gid} -G sudo sparkadmin

# Allow sparkadmin to use sudo without a password
RUN echo 'sparkadmin ALL = NOPASSWD: ALL' > /etc/sudoers.d/sparkadmin && chmod 0440 /etc/sudoers.d/sparkadmin

# Add a ccache directory
RUN mkdir -p /home/sparkadmin/.buildroot-ccache &&\
  chown -R sparkadmin.sparkadmin /home/sparkadmin

USER sparkadmin
VOLUME ["/spark", "/home/sparkadmin/.buildroot-ccache"]
WORKDIR /spark/spark-os
ENV USER sparkadmin
ENV HOME /home/sparkadmin
ENV PWD /spark/spark-os
CMD ["make"]
