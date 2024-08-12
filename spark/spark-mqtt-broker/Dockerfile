FROM node:8.15.1
WORKDIR /app
COPY package.json yarn.lock /app/
RUN yarn install --frozen-lockfile
COPY . /app
EXPOSE 1883
EXPOSE 9092
CMD ["yarn", "start"]
