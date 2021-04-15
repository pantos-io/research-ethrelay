FROM node:latest
LABEL maintainer="markus.levonyak@bitpanda.com"
WORKDIR /ethrelay
COPY package.json .
RUN npm install -g truffle@5.1.29
RUN npm install
COPY constants.js .
COPY contracts ./contracts
COPY migrations ./migrations
COPY test ./test
COPY truffle-config.js .
COPY utils ./utils
RUN truffle compile
ENTRYPOINT ["truffle"]
CMD ["--help"]
