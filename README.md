# Glass Garden

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

Then visit `http://localhost:3000`. If you are not accessing the website from `localhost` (i.e. it is running on a separate server), then you will need to set up a reverse proxy with HTTPS container functionality requires a secure context to work.

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
