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

Then visit `http://localhost:3000`. If you are not accessing the website from `localhost` (i.e. it is running on a separate server), then you will need to set up a reverse proxy with HTTPS because a lot of the functionality requires a secure context to work.

## Developing

Run the dev server and access on port `3000`:

```sh
git clone https://github.com/ThailerL/glass-garden.git
docker compose -f compose.dev.yaml up
```

WebContainers require HTTPS if you are not accessing from `localhost`. If you are developing on a remote machine, you can get around this by running a browser in a container on the remote machine and accessing `localhost:3000` from inside of it:

```sh
docker run -d --name=firefox --network host jlesage/firefox # Runs on port 5800
```
