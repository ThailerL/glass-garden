# InfraLab

## Developing

```sh
git clone https://github.com/ThailerL/infralab.git
docker compose up
```

Since this project uses docker, you can use the build script to commands in the build environment. For example:

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
