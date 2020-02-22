FROM node:12 AS build
WORKDIR /usr/src/app
COPY . .
RUN npm install

FROM node:12
WORKDIR /usr/src/app
COPY --from=build /usr/src/app /usr/src/app
EXPOSE 5000
CMD [ "node", "githttpserver.js" ]