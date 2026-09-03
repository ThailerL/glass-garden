# Glass Garden

[Try it live](https://glass.garden/) - a two-minute guided tour starts you off

Build cloud architecture by dragging load balancers, compute instances, and AWS services onto a canvas. Press play and watch real traffic move through it, right in your browser.

Everything on your canvas is running real code, and your app reaches it the way it would in production:

- compute instances running real Node processes whose code you can edit
- functions with Lambda's handler shape, running in execution environments that scale from zero
- a real Postgres server you connect to with the ordinary `pg` client
- an in-browser AWS region with S3, SQS, and DynamoDB you call with the ordinary AWS SDK

Click any resource to see its metrics, logs, and a live preview of what it's serving. The edges you draw are what grant access in real time.

It's all inside a WebAssembly VM in the tab, so there's nothing to install and nothing to sign up for. All your data stays on your device, and the whole thing is easily self-hostable.

## Self-hosting

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
docker run -p 3000:3000 ghcr.io/thailerl/glass-garden:latest
```

Then visit `http://localhost:3000`. If you are not accessing the website from `localhost` (e.g. it is running on a separate server), then you will need to set up a reverse proxy with HTTPS as the app requires a secure context to work.

## Developing

Run the dev server and access it on port `3000`:

```sh
git clone https://github.com/ThailerL/glass-garden.git
cd glass-garden
npm install
npm run dev
```

If developing on a remote machine, you can get around the HTTPS requirement by running a browser in a container on the remote machine:

```sh
docker run -d --name=firefox --network host jlesage/firefox
```

Then open `http://<remote-host>:5800` and browse to `localhost:3000`.
