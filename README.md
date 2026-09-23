# Glass Garden

Build cloud architecture by dragging load balancers, instance groups, and AWS services onto a canvas. Press play, use your app, and watch where requests go.

[demo.webm](https://github.com/user-attachments/assets/b7e0f4ca-5d52-4ecf-8c74-cd7caf46dc10)

_Three instances of a page-view counter behind a load balancer, with nowhere to keep the count until a Postgres database is dragged in and connected to the app. Each refresh is one request, drawn as a dot landing on the instance the page names._

Everything on your canvas is running real code, and your app talks to it the same way it would in production:

- instance groups running actual Node processes with editable code
- Lambda functions with the standard handler shape, running in execution environments that scale to zero
- a Postgres server you connect to with the ordinary `pg` client
- an in-browser AWS region with S3, SQS, and DynamoDB you call with the ordinary AWS SDK, powered by [Pocket Region](https://pocket-region.dev), which you can also use on its own in Node or a browser tab

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
	src="https://intro.embed.glass.garden/#garden=…"
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
<iframe src="https://intro.embed.glass.garden/?start#garden=…" …></iframe>
```

Leave it off when pressing start is part of the lesson.

These headers apply to the whole page, so other frames on it, such as YouTube videos, are blocked unless their site sends headers allowing it, and sign-in or payment popups from other sites can't report back to it. Sending them only on the pages that show a project leaves the rest of your site as it is.

The embed shows the project without the project list. What a reader does in it is kept by their browser for that subdomain on your site, so every page of yours with the same link picks the project up where the reader left off, and a different link on the same subdomain replaces it. Give every project or challenge its own subdomain, such as `intro.embed.glass.garden` and `scaling.embed.glass.garden`, so that moving between your pages never wipes one with another. Any name works and nothing is registered. Browsers treat this as data they can clear to free up space, so it suits following along with a lesson rather than keeping work.

## Writing challenges

A challenge gives the reader goals to meet. They get the canvas ready and press **Run**, and a script starts everything and then acts on it while the clock runs, stopping an app or raising the traffic. The goals are judged on what the system does while it plays, and saving is held until the run ends, so every run is scored on one canvas.

A run starts from the same state every time: every node is restarted, and every resource that stores something is cleared before the clock starts. So a goal is answered by what this run did rather than by what an earlier one left behind, and starting a run with the canvas already up costs nothing but the time it takes to come back. Starting and stopping nodes by hand is held until the run ends, the way saving is.

A challenge is a single JSON file that carries the canvas it starts from, so a share link hands out the challenge as written and never a reader's progress through it. Build that canvas as an ordinary project, export it, and paste what Export wrote under `startingCanvas`:

```json
{
	"$schema": "./schema.json",
	"format": "gg:challenge/1",
	"title": "Survive a lost app",
	"description": "One of two apps goes down for 25 seconds. Keep answering.",
	"suggests": ["httpLoadBalancer"],
	"instructions": [
		"Put a load balancer in front of the two apps and connect the traffic to it.",
		"Press Run. App A goes down partway through, and the run is scored on what the traffic sees while it is gone."
	],
	"length": 55,
	"events": [
		{ "at": 10, "stop": { "name": "App A" } },
		{ "at": 35, "text": "App A comes back", "start": { "name": "App A" } }
	],
	"fixed": [{ "node": { "name": "Traffic" } }],
	"goals": [
		{
			"id": "outage",
			"title": "Fewer than 1 in 20 requests fail while App A is down",
			"hint": "The balancer needs somewhere else to send requests.",
			"conditions": [
				{
					"metric": {
						"node": { "name": "Traffic" },
						"metricName": "errors",
						"statistic": "Average",
						"lte": 0.05,
						"from": 22,
						"to": 35
					}
				}
			]
		}
	],
	"startingCanvas": { "format": "gg:project/1", "nodes": […], "edges": […], "nodeFiles": {} }
}
```

Goals and events refer to a node by its name, which matches exactly one. Writing `{ "type": "dynamodbTable" }` instead matches every node of that type, which is how a goal asks the reader to add one, and each kind of condition says below how many of them have to satisfy it. A node the challenge names can't be deleted or renamed.

An event starts a node, stops it, or sets its settings, `at` so many seconds after everything reports running. Give it `text` and the timeline shows your sentence rather than a setting's name. `fixed` is the settings the challenge owns rather than the reader. Naming a node holds all of them, and `include` or `exclude` holds or releases only the ones you list. A setting some goal compares stays the reader's either way, since comparing it is how a challenge asks for it to be changed.

A goal is met when all of its conditions hold. Its `title` is read beside the seconds it is judged over, so word it as what has to be true then rather than as an instruction to the reader. An `exists` condition wants one matching node to exist, and takes `config` comparisons beside the node, as in `{ "exists": { "node": { "name": "App A" }, "config": { "maxConcurrency": { "gte": 2 } } } }`, each reading `eq`, `gte`, `lte`, or a mix. An `edge` condition wants one edge between a matching pair, `from` one node `to` another.

A `metric` condition holds any metric a node records, named by `metricName`, reading `eq`, `gte`, `lte`, or a mix, read by `Average`, `SampleCount`, `Sum`, `Minimum`, or `Maximum`, the same statistics the metrics tab offers, and it has to hold at every matching node that recorded anything rather than at one of them. Open that tab to see what a node records, whether that is a queue's messages, a function's concurrent executions, or whatever your own code reports. `dimensions` picks one series out of several published under the same name. `from` and `to` are the seconds of the run it is judged over, defaulting to the start and the end. `over` is what the bound is judged over, `"whole window"` unless you say otherwise, which folds the window into one number. `"every datapoint"` needs the bound to hold at every second in the window and fails at the one that breaks it, and `"any datapoint"` is met as soon as one second satisfies it. `period` folds that many seconds into each of those readings. It needs one of the datapoint reads, and has to divide the seconds between `from` and `to`. A stretch the node recorded nothing in is skipped rather than counted as zero.

A `data` condition asks what a resource holds, through one of the reads that kind of resource offers: a Table (DynamoDB) offers `item`, which takes the key of one item as its `args`. `has` compares what the read found, attribute by attribute, each one reading `eq`, `gte`, `lte`, or a mix, and a condition comparing nothing at all asks only that there is something there. Only an attribute holding a string, a number, or a boolean can be compared. The read is taken once, `at` that second of the run, or at its end where the goal says nothing, and the goal reads as still being judged until it answers. Every matching node has to satisfy it, and a `{ "type": … }` the reader never added fails, since there is nothing there to read. A read a resource does not offer, or arguments it cannot use, is refused as the file is read, and `schema.json` lists the names, so an editor offers them as you type.

Each goal has an `id` of your choosing, which is the name a run is scored by and the name an embedding page is told, so keep it short and leave it alone once anyone is reading it. No two goals can share one.

`length` is how long the run lasts, up to 900 seconds. A `hint` is offered once a scored run has failed its goal, and shown only when the reader asks for it.

`description` is the card on the Challenges page, read by someone deciding whether to start. The resources named and drawn beside it are read off `startingCanvas` rather than written out, minus the request generator, which is the traffic rather than part of the system and which every challenge has. `suggests` names the ones a reader is likely to reach for that the canvas does not start with, such as the queue and function behind an API that answers too slowly, and listing them describes the usual route without demanding it, since no goal asks for them by name. `instructions` stand in the challenge's own panel above the timeline, one paragraph per string, so what the reader has to do belongs there. A challenge needs a description and instructions, since a goal's title never says what to do.

Every name a goal or event mentions is checked as the file is read, so a challenge nobody could win is refused rather than failing halfway through a run. **Import** on the Challenges page takes the file, and what it imports appears under **Imported** there, where each card has a menu with **Export** and **Copy link**. Either one hands on the challenge as written rather than your progress through it. To ship your own with a self-hosted build, see [Your own built-in challenges](#your-own-built-in-challenges).

A challenge running in an embed tells your page how the reader is doing, so a lesson can react to a run without keeping score itself.

```js
window.addEventListener('message', (event) => {
	if (event.source !== frame.contentWindow || event.origin !== 'https://intro.embed.glass.garden')
		return;
	const message = event.data;
	if (message.format !== 'gg:embed/1') return;
	// { event: 'best', met: [...], goals: [{ id, title }, ...] } is the goals the reader's best run met and every goal the challenge has, sent on load and whenever the best improves
	// { event: 'run', scored: true, met: [...], failed: [...], goals: [{ id, title }, ...] } is every scored run
	// { event: 'run', scored: false, reason: 'did-not-start', nodeName: 'App A' } is a node that never started
	// { event: 'run', scored: false, reason: 'not-cleared', nodeName: 'Accounts' } is a resource the run could not clear before it began
});
```

`met` and `failed` name goals by the `id` each has in the challenge file, and `goals` lists every one with its `title` in the order the file gives, so a page can draw the whole checklist from the first message without repeating the challenge in its own code. Key what your page keeps by the `id`, since a title can be reworded. That first one is sent as the frame finishes loading and nothing can ask for it again, so add the listener before that happens rather than on your own page's load event, which fires after the frames in it. `reason` is a code rather than the wording the reader sees, so your page can say something of its own.

Ignore an `event` or a `reason` you don't know, since new ones can arrive without `format` changing. A page that missed the first message still has the whole checklist after one run, since a scored run carries `goals` as well.

Anyone can send these from their browser's console, so use them to show progress and offer help, never to award anything.

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

### Your own built-in challenges

The challenges in the catalogue are files the container serves from `/app/build/client/challenges`. Mount your own folder over it to replace them:

```yaml
services:
  glass-garden:
    volumes:
      - ./challenges:/app/build/client/challenges
```

The folder holds one `.json` file per challenge and an `index.json` listing them in the order the catalogue shows them:

```json
{
	"format": "gg:challenges/1",
	"challenges": [
		{
			"id": "first-challenge",
			"file": "first-challenge.json"
		}
	]
}
```

Everything a card says comes out of the challenge itself, so it reads the same here as it does for someone who imported the file. Each file is the same `gg:challenge/1` document that Export writes and a share link carries, so the way to write one is to build it on the canvas, export it, and drop it in. Copy [`static/challenges`](static/challenges) to start from the shipped ones.

A challenge is known by its `id`, which is what a reader's progress is stored against, so a file can be renamed freely, while changing an `id` makes it a challenge nobody has started and leaves the old record behind. Editing one in place is how a challenge changes: a reader keeps the goals they had met, apart from any the edit judges differently.

Keep `schema.json` in the folder and the `"$schema": "./schema.json"` line at the top of each challenge, and an editor will check the file as you type it. A file that will not parse is named on the catalogue page with what was wrong, and the rest of the folder still loads.

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
docker run -d --name=firefox --network host \
  -e FF_PREF_JSPI=javascript.options.wasm_js_promise_integration=true \
  jlesage/firefox
```

The preference turns on WebAssembly JSPI, which the local AWS region needs.

Then open `http://<remote-host>:5800` and browse to `localhost:3000`.

The pages under `/about` are a separate Astro project in `site/`, with a dev server of its own:

```sh
npm run dev:site
```

That serves them on port `4321`, so the hub page is at `http://localhost:4321/about`. Astro runs it in the background rather than holding the terminal, so stop it with `npm run dev:site -- stop`, and put `status` or `logs` in place of `stop` to check on it. Add `npm run dev:site -- --host` to reach it from another machine.

The app's own dev server serves these pages from whatever `npm run build:site` last wrote into `static/`, so they are stale or missing until you run it, and it serves them only at their exact paths, so `/about/index.html` works there and `/about` does not. To see them as they are deployed, and to see the running canvas the About page embeds, run `npm run build` and then `npm run preview`.
