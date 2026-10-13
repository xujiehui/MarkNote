import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { installDomGlobals } from './domGlobals';
import { sanitizeContentUrl, sanitizeNoteContent } from '../src/lib/sanitizeContent';
import { noteHtmlDocument } from '../src/lib/html';
import { fileToBase64Image, validateImageDimensions } from '../src/lib/image';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://notes.example/' });
installDomGlobals({ window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, File: dom.window.File });

async function main() {
  const payloads = [
    '<img src="x" onerror="window.marker = 1"><script>window.marker = 1</script>',
    '<a href="java&#x09;script:alert(1)" onclick="alert(1)">link</a>',
    '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==" download="page.html">file</a>',
    '<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe><object data="https://evil.example"></object>',
    '<svg><foreignObject><p onclick="alert(1)">x</p></foreignObject></svg><math><mtext><img src=x onerror=alert(1)></mtext></math>',
    '<form id="location"><input name="href" value="https://evil.example"></form><p style="background:url(https://evil.example/ping);position:fixed;inset:0">text</p>',
    '<img src="https://safe.example/a.png" srcset="https://evil.example/a.png 2x" style="width: expression(alert(1));background:url(javascript:alert(1))">',
    '<video src="javascript:alert(1)" poster="data:text/html;base64,eA==" onloadeddata="alert(1)"></video>',
    '<template><img src=x onerror=alert(1)></template><a href="file:///etc/passwd">local</a>',
  ];
  for (const payload of payloads) {
    const content = sanitizeNoteContent(payload);
    const parsed = new dom.window.DOMParser().parseFromString(content, 'text/html');
    assert.equal(parsed.querySelector('script,svg,math,iframe,object,embed,form,template'), null, payload);
    for (const element of parsed.querySelectorAll('*')) {
      for (const attribute of Array.from(element.attributes)) {
        assert.equal(/^on/i.test(attribute.name), false, payload);
        assert.equal(/(?:javascript:|vbscript:|expression\(|background:|position:)/i.test(attribute.value), false, payload);
      }
    }
    assert.equal(sanitizeNoteContent(content), content, `Sanitizer must be idempotent: ${payload}`);
  }

  const valid = '<h2>标题</h2><p><strong>bold</strong><u>underlined</u></p>'
    + '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked="checked"><span></span></label><div><p>done</p></div></li></ul>'
    + '<img src="data:image/png;base64,aGVsbG8=" alt="截图" width="50%" style="width: 50%;" data-align="left" data-attachment-id="image-1">'
    + '<pre data-code-block-id="code-1"><code class="language-javascript">const x = 1;</code></pre>'
    + '<video src="marknote-attachment://video-1" data-attachment-id="video-1" controls="true"></video>'
    + '<audio src="data:audio/mpeg;base64,aGVsbG8=" data-attachment-id="audio-1" controls="true"></audio>'
    + '<file-attachment href="data:application/pdf;base64,cGRm" filename="合同.pdf" data-attachment-id="file-1"></file-attachment>'
    + '<a class="marknote-file-attachment" href="marknote-attachment://file-2" download="a.txt" data-attachment-id="file-2">a.txt</a>';
  const cleaned = sanitizeNoteContent(valid);
  const parsed = new dom.window.DOMParser().parseFromString(cleaned, 'text/html');
  assert.equal(parsed.querySelector('li')?.getAttribute('data-checked'), 'true');
  assert.equal(parsed.querySelector('input')?.hasAttribute('checked'), true);
  assert.equal(parsed.querySelector('input')?.hasAttribute('disabled'), true);
  assert.equal(parsed.querySelector('img')?.getAttribute('width'), '50%');
  assert.equal(parsed.querySelector('img')?.getAttribute('style'), 'width: 50%;');
  assert.equal(parsed.querySelector('img')?.getAttribute('data-attachment-id'), 'image-1');
  assert.equal(parsed.querySelector('code')?.getAttribute('class'), 'language-javascript');
  assert.equal(parsed.querySelector('video')?.getAttribute('src'), 'marknote-attachment://video-1');
  assert.equal(parsed.querySelector('audio')?.getAttribute('src'), 'data:audio/mpeg;base64,aGVsbG8=');
  assert.equal(parsed.querySelector('file-attachment')?.getAttribute('href'), 'data:application/pdf;base64,cGRm');
  assert.equal(parsed.querySelector('a')?.getAttribute('href'), 'marknote-attachment://file-2');
  assert.equal(parsed.querySelector('a')?.getAttribute('download'), 'a.txt');
  assert.equal(parsed.querySelector('a')?.getAttribute('data-attachment-id'), 'file-2');
  assert.equal(sanitizeNoteContent(cleaned), cleaned);

  for (const url of ['javascript:alert(1)', 'java\nscript:alert(1)', '//evil.example/x', 'file:///tmp/a', 'https://user:secret@example.com/a', 'https://example.com/\u0000a', 'blob:https://evil.example/abc']) {
    assert.equal(sanitizeContentUrl(url, 'image'), null, url);
  }
  assert.equal(sanitizeContentUrl('https://example.com/a.png', 'image'), 'https://example.com/a.png');
  assert.equal(sanitizeContentUrl('mailto:person@example.com', 'link'), 'mailto:person@example.com');
  assert.equal(sanitizeContentUrl('mailto:person@example.com?body=x%0D%0AInjected', 'link'), null);
  assert.equal(sanitizeContentUrl('marknote-attachment://%E0%A4%A', 'file'), null);
  assert.equal(sanitizeContentUrl('data:image/png;base64,a', 'image'), null);
  assert.equal(sanitizeContentUrl('data:application/pdf;base64,cGRm', 'image'), null);

  const html = noteHtmlDocument('<img onerror=alert(1)>', payloads.join('') + '<pre><code class="language-js">&lt;img onerror=alert(1)&gt;</code></pre>');
  const exported = new dom.window.DOMParser().parseFromString(html, 'text/html');
  assert.equal(exported.querySelector('script,iframe,object,svg'), null);
  assert.equal(exported.querySelector('[onerror],[onclick],[onloadeddata]'), null);
  assert.match(exported.querySelector('meta[http-equiv]')?.getAttribute('content') || '', /default-src 'none'/);
  assert.match(exported.querySelector('code')?.textContent || '', /<img onerror=alert\(1\)>/);
  assert.match(html, /hljs-/);
  // JSDOM deliberately does not enforce CSP. This verifies sanitization independently
  // by attempting to run retained handlers in the generated document.
  const execution = new JSDOM(html, { runScripts: 'dangerously' });
  for (const element of execution.window.document.querySelectorAll('*')) {
    for (const event of ['error', 'load', 'click', 'loadeddata']) {
      element.dispatchEvent(new execution.window.Event(event));
    }
  }
  assert.equal((execution.window as unknown as { marker?: number }).marker, undefined);
  execution.window.close();

  validateImageDimensions(5000, 4000);
  for (const dimensions of [[0, 1], [NaN, 1], [1.5, 1], [5001, 4000]]) {
    assert.throws(() => validateImageDimensions(dimensions[0], dimensions[1]));
  }
  await assert.rejects(fileToBase64Image(new File(['<svg></svg>'], 'x.svg', { type: 'image/svg+xml' })), /SVG/);
  await assert.rejects(fileToBase64Image(new File([], 'empty.png', { type: 'image/png' })), /不能为空/);
  console.log('content security tests passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
