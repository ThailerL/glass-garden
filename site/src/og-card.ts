import type { ChallengeDocument } from '../../src/lib/project-document';
import { layoutCanvas, NODE_SIZE, type PlacedNode } from './canvas-layout';
import { goalCount } from './challenges';
import { nodeSubtitle, resourceOf } from './resources';

// The size every scraper crops to, and what the app's own static/og.png already is
const CARD = { width: 1200, height: 630 };

// Dark tokens from src/lib/theme.css: an SVG renderer reads no CSS var, and a link preview has
// no page around it to take a scheme from
const COLOR = {
	canvas: '#080b0f',
	pattern: '#2e333a',
	node: '#181c22',
	nodeBorder: '#2b3440',
	text: '#f1f4f6',
	muted: '#9ba0a9',
	icon: '#4bc680'
};

const MARGIN = 64;
const FOOTER = 110;
// No title on the card: every scraper prints og:title beside the image
const DRAWING = { top: 60, height: CARD.height - 60 - FOOTER };
// The kind sits under the box, where it has the column's whole width
const SUBTITLE_ROOM = 30;
const NAME = { size: 13, weight: 500 };
const SUBTITLE = { size: 11, weight: 400 };

function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

// Errs wide: Inter has no fixed advance, and an overflowing line is what a reader notices
function wrapped(text: string, fontSize: number, room: number): string[] {
	const lines: string[] = [];
	for (const word of text.split(' ')) {
		const line = lines.at(-1);
		if (line && (line.length + 1 + word.length) * fontSize * 0.58 <= room) {
			lines[lines.length - 1] = `${line} ${word}`;
			continue;
		}
		lines.push(word);
	}
	return lines;
}

function label(
	lines: string[],
	centre: number,
	top: number,
	{ size, weight }: { size: number; weight: number },
	fill: string
): string {
	return lines
		.map(
			(line, index) =>
				`<text x="${centre}" y="${top + index * (size + 2)}" text-anchor="middle" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeXml(line)}</text>`
		)
		.join('');
}

function node({ node: { type, config }, left, top }: PlacedNode): string {
	const centre = left + NODE_SIZE / 2;
	// Centred under the icon, so a name that takes two lines grows evenly
	const name = wrapped(String(config.name ?? type), NAME.size, NODE_SIZE - 16);
	const subtitle = wrapped(nodeSubtitle(type, config), SUBTITLE.size, NODE_SIZE + 40);

	// The icon is drawn at 24 units square, as every resource definition writes it
	const icon = `<g transform="translate(${centre - 18} ${top + 24}) scale(1.5)" fill="none" stroke="${COLOR.icon}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${resourceOf(type).icon}</g>`;
	return `
		<rect x="${left}" y="${top}" width="${NODE_SIZE}" height="${NODE_SIZE}" rx="14" fill="${COLOR.node}" stroke="${COLOR.nodeBorder}" />
		${icon}
		${label(name, centre, top + 82 - (name.length - 1) * 8, NAME, COLOR.text)}
		${label(subtitle, centre, top + NODE_SIZE + 14, SUBTITLE, COLOR.muted)}`;
}

export function cardSvg(document: ChallengeDocument): string {
	const { placed, wires, width, height } = layoutCanvas(document.startingCanvas);

	// Scaled up to fill the drawing area rather than sitting small in the middle
	const drawn = height + SUBTITLE_ROOM;
	const scale = Math.min((CARD.width - MARGIN * 2) / width, DRAWING.height / drawn, 2.4);
	const left = (CARD.width - width * scale) / 2;
	const top = DRAWING.top + (DRAWING.height - drawn * scale) / 2;

	const lines = wires
		.map(
			(wire) =>
				`<line x1="${wire.x1}" y1="${wire.y1}" x2="${wire.x2}" y2="${wire.y2}" stroke="${COLOR.muted}" stroke-width="1.5" />`
		)
		.join('');

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD.width}" height="${CARD.height}" viewBox="0 0 ${CARD.width} ${CARD.height}" font-family="Inter">
	<defs>
		<pattern id="dots" width="18" height="18" patternUnits="userSpaceOnUse">
			<circle cx="1" cy="1" r="1" fill="${COLOR.pattern}" />
		</pattern>
	</defs>
	<rect width="${CARD.width}" height="${CARD.height}" fill="${COLOR.canvas}" />
	<rect width="${CARD.width}" height="${CARD.height}" fill="url(#dots)" />
	<g transform="translate(${left} ${top}) scale(${scale})">
		${lines}
		${placed.map(node).join('')}
	</g>
	<text x="${MARGIN}" y="${CARD.height - 44}" font-size="22" font-weight="500" fill="${COLOR.muted}">Glass Garden</text>
	<text x="${CARD.width - MARGIN}" y="${CARD.height - 44}" text-anchor="end" font-size="22" fill="${COLOR.muted}">${document.length}-second run · ${goalCount(document)}</text>
</svg>`;
}
