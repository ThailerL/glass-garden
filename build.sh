#/usr/bin/env sh
docker run --rm -it -u $(id -u):$(id -g) -v ./:/app -w /app timbru31/node-alpine-git $@
