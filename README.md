# InfraLab

## Developing

Run the dev server and access on port `3000`:

```sh
git clone https://github.com/ThailerL/infralab.git
docker compose -f compose.dev.yaml up
```

WebContainers require HTTPS if you are not accessing from `localhost`. If you are developing on a remote machine, you can get around this by running a browser in a container on the remote machine and accessing `localhost:3000` from inside of it:

```sh
docker run -d --name=firefox --network host jlesage/firefox # Runs on port 5800
```

Since this project uses docker, you can use the build script to run commands in the build environment. For example:

```sh
./build.sh npm install
./build.sh npx shadcn-svelte@latest add label
```