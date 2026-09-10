# Glass Garden

Build cloud architecture by dragging load balancers, instance groups, and AWS services onto a canvas. Press play, use your app, and watch where requests go.

[demo.webm](https://github.com/user-attachments/assets/b7e0f4ca-5d52-4ecf-8c74-cd7caf46dc10)

_Three instances of a page-view counter behind a load balancer, with nowhere to keep the count until a Postgres database is dragged in and connected to the app. Each refresh is answered by the next instance in turn._

Everything on your canvas is running real code, and your app talks to it the same way it would in production:

- instance groups running actual Node processes with editable code
- Lambda functions with the standard handler shape, running in execution environments that scale to zero
- a Postgres server you connect to with the ordinary `pg` client
- an in-browser AWS region with S3, SQS, and DynamoDB you call with the ordinary AWS SDK

Access between resources works by drawing edges between them, and a call the canvas does not allow is refused.

It's all inside a WebAssembly VM in the tab, so there's nothing to install or sign up for. Nothing leaves your machine, and the whole thing is easily self-hostable.

A two-minute guided tour starts you off at [glass.garden](https://glass.garden/).

## Look inside any resource

Click on any resource for its metrics, logs, and a window into whatever it's serving. Or pin their charts to the canvas to create a live dashboard.

[queue-demo.webm](https://github.com/user-attachments/assets/9324e82c-18ab-4c59-b98a-c497bc655c5a)

_A signup API drops each new password onto a queue for a Lambda function to hash. Signups come in faster than one execution environment can keep up, so the backlog grows until the function's concurrency is raised and it drains._

## Drive it from a terminal

Every project has a terminal, and the `aws` command is on the PATH of every shell in it. It reaches the same in-browser region your code does, so you can list a bucket, put a message on a queue, or invoke a function by hand.

[aws-cli-demo.webm](https://github.com/user-attachments/assets/0db7a7c4-57b0-49fe-b755-27a6c7bd25e4)

_A notes app keeps each note as an object in a bucket. `aws s3 ls` prints the same keys the app is showing, and a note copied into the bucket from the shell appears in the app on its next page load._

## Embedding

A project can run inside a page on another site, such as a blog post or a course. Right-click a project in the sidebar, choose **Copy link**, and put the link in an iframe with its address changed to a subdomain of `embed.glass.garden` named for the project:

```html
<iframe
	src="https://intro.embed.glass.garden/#project=…"
	allow="cross-origin-isolated"
	loading="lazy"
	width="100%"
	height="700"
></iframe>
```

The servers inside the frame need the browser's cross-origin isolation, so the page showing it has to send two headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

Without them the frame shows an **Open in Glass Garden** link instead.

To have everything on the canvas start by itself the first time a reader scrolls to it, add `?start` before the `#`:

```html
<iframe src="https://intro.embed.glass.garden/?start#project=…" …></iframe>
```

Leave it off when pressing start is part of the lesson.

These headers apply to the whole page, so other frames on it, such as YouTube videos, are blocked unless their site sends headers allowing it, and sign-in or payment popups from other sites can't report back to it. Sending them only on the pages that show a project leaves the rest of your site as it is.

The embed shows the project without the project list. What a reader does in it is kept by their browser for that subdomain on your site, so every page of yours with the same link picks the project up where the reader left off, and a different link on the same subdomain replaces it. Give every project its own subdomain, such as `intro.embed.glass.garden` and `scaling.embed.glass.garden`, so that moving between your pages never wipes one project with another. Any name works and nothing is registered. Browsers treat this as data they can clear to free up space, so it suits following along with a lesson rather than keeping work.

## Self-hosting

To self-host with Docker, use this `compose.yaml`

```yaml
services:
  glass-garden:
    image: ghcr.io/thailerl/glass-garden:latest
    container_name: glass-garden
    ports:
      - '3000:3000'
    environment:
      PUBLIC_ORIGIN: https://garden.example.com
    restart: unless-stopped
```

or run

```sh
docker run -p 3000:3000 ghcr.io/thailerl/glass-garden:latest
```

Then visit `http://localhost:3000`. If you are not accessing the website from `localhost` (e.g. it is running on a separate server), then you will need to set up a reverse proxy with HTTPS as the app requires a secure context to work. Set `PUBLIC_ORIGIN` to the address you reach it at so that links to it show a preview image when shared.

To embed your instance of Glass Garden, point the wildcard `*.embed.garden.example.com` at the same container.

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
