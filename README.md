# Glass Garden

Build cloud architecture by dragging load balancers, instance groups, and AWS services onto a canvas. Press play, use your app, and watch where requests go.

[demo.webm](https://github.com/user-attachments/assets/5f7b851c-0ac5-4eb7-804b-eda8d9372893)

*Three instances of a page-view counter behind a load balancer, with nowhere to keep the count until a Postgres database is dragged in and connected to the app. Each refresh is answered by a different instance.*

Everything on your canvas is running real code, and your app talks to it the same way it would in production:

- instance groups running actual Node processes with editable code
- Lambda functions with the standard handler shape, running in execution environments that scale to zero
- a Postgres server you connect to with the ordinary `pg` client
- an in-browser AWS region with S3, SQS, and DynamoDB you call with the ordinary AWS SDK

Click on any resource for its metrics, logs, and a window into whatever it's serving. Or pin their charts to the canvas to create a live dashboard. Access between resources works by drawing edges between them.

![A signup API, a queue, and a Lambda function, each with a chart of its metrics](https://github.com/user-attachments/assets/1cfe9994-29bc-42d0-93bc-d3c8be8283be)

*A signup API drops each new password onto a queue for a Lambda function to hash. Signups come in faster than one execution environment can keep up, so the backlog grows until the function's concurrency is raised and it drains.*

It's all inside a WebAssembly VM in the tab, so there's nothing to install or sign up for. Nothing leaves your machine, and the whole thing is easily self-hostable.

A two-minute guided tour starts you off at [glass.garden](https://glass.garden/).

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
