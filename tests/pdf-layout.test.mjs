import test from 'node:test';
import assert from 'node:assert/strict';
import {drawingRectangles, visualRegions, textLines, captionLines} from '../frontend/scripts/pdf-layout.mjs';

// Just enough of pdf.js to drive the detector: the operator codes it switches
// on, the matrix helper it multiplies with, and a viewport that maps page
// coordinates to canvas pixels one for one.
const OPS = {save:1,restore:2,transform:3,setFillRGBColor:4,setStrokeRGBColor:5,constructPath:6,
             fill:7,eoFill:8,fillStroke:9,eoFillStroke:10,closeFillStroke:11,closeEOFillStroke:12,
             stroke:13,closeStroke:14,clip:15,eoClip:16,endPath:17,
             paintImageXObject:18,paintInlineImageXObject:19};
const transform = (m, a) => [
  m[0]*a[0]+m[2]*a[1], m[1]*a[0]+m[3]*a[1],
  m[0]*a[2]+m[2]*a[3], m[1]*a[2]+m[3]*a[3],
  m[0]*a[4]+m[2]*a[5]+m[4], m[1]*a[4]+m[3]*a[5]+m[5],
];
const view = {scale:1, convertToViewportPoint:(x,y)=>[x,y], convertToViewportRectangle:r=>[r[0],r[1],r[2],r[3]]};
const list = rows => ({fnArray: rows.map(r=>r[0]), argsArray: rows.map(r=>r[1])});
const path = (x0,y0,x1,y1) => [OPS.constructPath, [[], [], [x0,y0,x1,y1]]];
const word = (str,x,y,w,h=10) => ({str, width:w, height:h, transform:[h,0,0,h,x,y+h]});

test('drawing rectangles follow the graphics transform stack', () => {
  const ops = list([
    [OPS.save, []],
    [OPS.transform, [2,0,0,2,100,50]],
    path(0,0,10,10),
    [OPS.stroke, []],
    [OPS.restore, []],
    path(0,0,10,10),
    [OPS.fill, []],
  ]);
  const drawn = drawingRectangles(ops, OPS, transform);
  assert.equal(drawn.length, 2);
  assert.deepEqual(drawn[0].rect, [100,50,120,70]);
  assert.equal(drawn[0].filled, false);
  assert.deepEqual(drawn[1].rect, [0,0,10,10]);
  assert.equal(drawn[1].filled, true);
});

test('a plain horizontal rule keeps its thickness instead of being discarded', () => {
  const drawn = drawingRectangles(list([path(20,300,220,300), [OPS.stroke, []]]), OPS, transform);
  assert.equal(drawn.length, 1);
  assert.deepEqual(drawn[0].rect, [20,300,220,300]);
});

test('a chapter banner and a page-number tile are never figures', () => {
  const ops = list([
    [OPS.setFillRGBColor,[0.78,0.92,0.99]], path(0,0,600,340), [OPS.fill,[]],   // cover panel
    [OPS.setFillRGBColor,[0.78,0.92,0.99]], path(500,760,540,782), [OPS.fill,[]], // page number tile
  ]);
  const regions = visualRegions({ops, OPS, transform, items:[], view, width:600, height:800});
  assert.deepEqual(regions, []);
});

test('a captioned line drawing is assembled into one figure', () => {
  const ops = list([
    path(120,240,300,250), [OPS.stroke,[]],
    path(120,240,130,400), [OPS.stroke,[]],
    path(150,300,260,380), [OPS.stroke,[]],
    path(180,260,240,330), [OPS.fill,[]],
  ]);
  const items = [word('FIGURE 1.4 Rods repel', 120, 420, 150)];
  const regions = visualRegions({ops, OPS, transform, items, view, width:600, height:800});
  assert.equal(regions.length, 1);
  assert.equal(regions[0].kind, 'figure');
  assert.match(regions[0].caption, /^FIGURE 1\.4/);
  assert.ok(regions[0].rect[0] >= 110 && regions[0].rect[2] <= 310, 'the crop is the drawing, not the column');
});

test('a stack of fraction bars beside a caption is not a diagram', () => {
  const ops = list([
    path(120,240,300,241), [OPS.fill,[]],
    path(130,300,290,301), [OPS.fill,[]],
    path(125,360,295,361), [OPS.fill,[]],
  ]);
  const items = [word('FIGURE 1.4 Rods repel', 120, 420, 150)];
  assert.deepEqual(visualRegions({ops, OPS, transform, items, view, width:600, height:800}), []);
});

test('a caption does not absorb the body column beside it', () => {
  const lines = textLines([
    word('FIGURE 1.2 Electroscopes', 70, 400, 120),
    word('We have not as yet given a quantitative definition', 330, 400, 200),
  ], view);
  const captions = captionLines(lines);
  assert.equal(captions.length, 1);
  assert.equal(captions[0].text, 'FIGURE 1.2 Electroscopes');
});
