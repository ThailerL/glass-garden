# Glass Garden

A sandbox for experimenting with cloud infrastructure like load balancers, compute instances, and databases. Everything on your canvas is running real code: your instances are real Node processes, and your database is a real Postgres server speaking the wire protocol. Pop open an instance group and you get a full code editor, so you can edit the actual app your instances are running. Press play and watch it run, right in your browser. It's all inside a WebAssembly VM in the tab, so there's nothing to install and nothing to sign up for. All your data stays on your device, and the whole thing is easily self-hostable.

## Setup

To self-host with Docker, use this `compose.yaml`

```yaml
services:
  glass-garden:
    image: ghcr.io/thailerl/glass-garden:latest
    container_name: glass-garden
    ports:
      - '3000:3000'
    restart: unless-stopped
```

or run

```sh
docker run -p 3000:3000  ghcr.io/thailerl/glass-garden:latest
```

Then visit `http://localhost:3000`. If you are not accessing the website from `localhost` (i.e. it is running on a separate server), then you will need to set up a reverse proxy with HTTPS as the app requires a secure context to work.

## Developing

Run the dev server and access it on port `3000`:

```sh
git clone https://github.com/ThailerL/glass-garden.git
cd glass-garden
npm install
npm run dev
```

The in-browser container needs a secure context for `SharedArrayBuffer`, so it requires HTTPS if you are not accessing from `localhost`. If you are developing on a remote machine, you can get around this by running a browser in a container on the remote machine and accessing `localhost:3000` from inside of it:

```sh
docker run -d --name=firefox --network host jlesage/firefox # Runs on port 5800
```
