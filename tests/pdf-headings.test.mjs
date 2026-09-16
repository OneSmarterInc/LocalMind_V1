import test from 'node:test';
import assert from 'node:assert/strict';
import {headingItems, documentHeadings} from '../frontend/scripts/pdf-headings.mjs';

// A page record as the private PDF importer builds it: the readable page text,
// plus one entry per visual line with its type size and vertical position.
const line = (text, size = 10, y = 300) => ({text, size, y0: y, y1: y + size});
const page = (n, text, lines) => ({page: n, text, lines, height: 1000, visualIds: [`v${n}`], ocr: false});

const body = 'Charges acquired after rubbing are lost when the charged bodies are brought into contact again, which tells us that unlike charges neutralise each other and the effect is cancelled completely in every case examined so far.';

test('a numbered chapter is split at its headings, not at page breaks', () => {
  const pages = [
    page(1, `1.1 INTRODUCTION ${body} 1.2 ELECTRIC CHARGE ${body}`,
      [line('1.1 INTRODUCTION', 13), line(body, 10, 350), line('1.2 ELECTRIC CHARGE', 13, 600), line(body, 10, 650)]),
    page(2, `${body} 1.3 CONDUCTORS AND INSULATORS ${body}`,
      [line(body, 10, 200), line('1.3 CONDUCTORS AND INSULATORS', 13, 500), line(body, 10, 560)]),
    page(3, body, [line(body, 10, 200)]),
  ];
  const items = headingItems(pages);
  assert.equal(items.length, 3);
  assert.deepEqual(items.map(i => i.title), ['1.1 INTRODUCTION', '1.2 ELECTRIC CHARGE', '1.3 CONDUCTORS AND INSULATORS']);
  // A section that runs past a page break keeps its whole page range.
  assert.deepEqual([items[1].page, items[1].endPage], [1, 2]);
  assert.deepEqual([items[2].page, items[2].endPage], [2, 3]);
  // Each section is its own group, so two sections starting on one page are
  // never joined back together as if they were parts of one reading.
  assert.equal(new Set(items.map(i => i.group)).size, 3);
});

test('a page picture goes to the section holding most of that page', () => {
  const pages = [
    page(1, `1.1 INTRODUCTION ${body}`, [line('1.1 INTRODUCTION', 13), line(body, 10, 350)]),
    page(2, `${body} ${body} 1.2 ELECTRIC CHARGE short tail`,
      [line(body, 10, 200), line(body, 10, 400), line('1.2 ELECTRIC CHARGE', 13, 800), line('short tail', 10, 860)]),
  ];
  const items = headingItems(pages);
  assert.ok(items[0].visualIds.includes('v2'), 'page 2 is mostly the first section, so its picture belongs there');
  assert.ok(!items[1].visualIds.includes('v2'));
});

test('display equations are not read as numbered headings', () => {
  const pages = [
    page(1, `1.1 INTRODUCTION ${body} 1 q q 1 2 4 π ε 0 r ${body}`,
      [line('1.1 INTRODUCTION', 13), line(body, 10, 300), line('1 q q 1 2', 11, 500), line('4 π ε 0 r', 11, 540), line(body, 10, 600)]),
    page(2, `1.2 ELECTRIC CHARGE ${body}`, [line('1.2 ELECTRIC CHARGE', 13), line(body, 10, 300)]),
  ];
  assert.deepEqual(documentHeadings(pages).map(h => h.text), ['1.1 INTRODUCTION', '1.2 ELECTRIC CHARGE']);
});

test('numbered exercises at the back of a chapter are not headings', () => {
  const pages = [
    page(1, `1.1 INTRODUCTION ${body}`, [line('1.1 INTRODUCTION', 13), line(body, 10, 300)]),
    page(2, `1.2 ELECTRIC CHARGE ${body}`, [line('1.2 ELECTRIC CHARGE', 13), line(body, 10, 300)]),
    page(3, `1.3 CONDUCTORS ${body}`, [line('1.3 CONDUCTORS', 13), line(body, 10, 300)]),
    page(4, `1.1 What is the force between two small charged spheres having charges of 2 nC ${body}`,
      [line('1.1 What is the force between two small charged spheres having charges', 10, 200), line(body, 10, 300)]),
  ];
  assert.deepEqual(documentHeadings(pages).map(h => h.number), ['1.1', '1.2', '1.3']);
});

test('a book with no usable headings falls back rather than guessing', () => {
  const pages = [page(1, body, [line(body)]), page(2, body, [line(body, 10, 400)])];
  assert.equal(headingItems(pages), null);
});

test('small capitals and possessives are read as single words', () => {
  const pages = [
    page(1, `1.5 COULOMB ’ S LAW ${body}`, [line('1.5 C OULOMB ’ S L AW', 13), line(body, 10, 300)]),
    page(2, `1.6 FORCES ${body}`, [line('1.6 F ORCES', 13), line(body, 10, 300)]),
    page(3, `1.7 ELECTRIC FIELD ${body}`, [line('1.7 E LECTRIC F IELD', 13), line(body, 10, 300)]),
  ];
  assert.deepEqual(documentHeadings(pages).map(h => h.text), ['1.5 COULOMB’S LAW', '1.6 FORCES', '1.7 ELECTRIC FIELD']);
});
