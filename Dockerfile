# Based on latest Node.js image
FROM node:latest
# Maintainer of the image
LABEL maintainer="markus.levonyak@bitpanda.com"
# Globally install required version of truffle
RUN npm install -g truffle@5.1.29
# Set ethrelay home directory as working directory
WORKDIR /ethrelay
# Copy package dependencies file from context to working directory
COPY package.json .
# Install package dependencies in working directory
RUN npm install
# Copy all required ethrelay files from context to working directory
COPY constants.js .
COPY contracts ./contracts
COPY migrations ./migrations
COPY test ./test
COPY truffle-config.js .
COPY utils ./utils
# Compile smart contracts in working directory
RUN truffle compile
# Add script to test if a given TCP host/port is available and make it executable
ADD https://raw.githubusercontent.com/vishnubob/wait-for-it/master/wait-for-it.sh .
RUN chmod 755 wait-for-it.sh
# Execute truffle when running the image
ENTRYPOINT ["truffle"]
# Default argument for truffle
CMD ["--help"]
