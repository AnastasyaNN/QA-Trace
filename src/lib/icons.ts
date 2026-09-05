const SVG_NS = 'http://www.w3.org/2000/svg'
const SVG_ATTRIBUTES: Record<string, string> = {
    viewBox: '0 0 24 24', width: '16', height: '16', fill: 'none', stroke: 'currentColor',
    'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round'
}

type IconShape = [tag: string, attributes: Record<string, string>]

export type IconName = 'copy' | 'browse' | 'screenshot' | 'settings' | 'trash'

const ICON_SHAPES: Record<IconName, IconShape[]> = {
    copy: [
        ['rect', {x: '9', y: '9', width: '13', height: '13', rx: '2'}],
        ['path', {d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'}]
    ],
    browse: [
        ['path', {d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'}],
        ['polyline', {points: '15 3 21 3 21 9'}],
        ['line', {x1: '10', y1: '14', x2: '21', y2: '3'}]
    ],
    screenshot: [
        ['rect', {x: '3', y: '5', width: '18', height: '14', rx: '2'}],
        ['circle', {cx: '12', cy: '12', r: '3'}]
    ],
    settings: [
        ['circle', {cx: '12', cy: '12', r: '3'}],
        ['path', {d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'}]
    ],
    trash: [
        ['polyline', {points: '3 6 5 6 21 6'}],
        ['path', {d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'}],
        ['line', {x1: '10', y1: '11', x2: '10', y2: '17'}],
        ['line', {x1: '14', y1: '11', x2: '14', y2: '17'}]
    ]
}

export class IconUtils {
    static create(name: IconName): SVGElement {
        const svg = IconUtils.svgElement('svg', SVG_ATTRIBUTES)
        ICON_SHAPES[name].forEach(([tag, attributes]) => svg.appendChild(IconUtils.svgElement(tag, attributes)))
        return svg
    }

    private static svgElement(tag: string, attributes: Record<string, string>): SVGElement {
        const element = document.createElementNS(SVG_NS, tag)
        Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value))
        return element
    }
}
