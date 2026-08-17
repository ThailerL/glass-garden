# InfraLab

## Developing

Run the dev server:

```sh
git clone https://github.com/ThailerL/infralab.git
docker compose up
```

WebContainers require HTTPS if you are not accessing from `localhost`. So if you are developing on a remote machine, you can get around this by running a brower in a container on the remote machine and access `localhost:3000` from there

```sh
docker run -d --name=firefox --network host jlesage/firefox # Runs on port 5800
```

Since this project uses docker, you can use the build script to run commands in the build environment. For example:

```sh
./build.sh npm install
./build.sh npx shadcn-svelte@latest add label
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
