FROM node:8.15.1

RUN apt-get update && apt-get install -y \
      xfonts-75dpi \
      xfonts-base \
    && rm -rf /var/lib/apt/lists/*

ARG WKHTMLTOPDF_VERSION=0.12.5
ENV WKHTMLTOPDF_VERSION ${WKHTMLTOPDF_VERSION}
ENV WKHTMLTOPDF_DEB wkhtmltox_${WKHTMLTOPDF_VERSION}-1.stretch_amd64.deb
RUN curl -L https://github.com/wkhtmltopdf/wkhtmltopdf/releases/download/${WKHTMLTOPDF_VERSION}/${WKHTMLTOPDF_DEB} \
        -o "${WKHTMLTOPDF_DEB}"
RUN dpkg -i ${WKHTMLTOPDF_DEB} &&\
    rm -f ${WKHTMLTOPDF_DEB}

WORKDIR /app
COPY package.json yarn.lock /app/
RUN yarn install --frozen-lockfile
COPY . /app
CMD ["yarn", "build"]
