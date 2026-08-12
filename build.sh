#/usr/bin/env sh
node=`grep -m 1 -i '^FROM' Dockerfile | awk '{print $2}'`
docker run --rm -it -u $(id -u):$(id -g) -v ./:/app -w /app $node $@
