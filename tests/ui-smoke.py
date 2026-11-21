"""Optional Chromium smoke test using local synthetic audio only."""
from threading import Thread
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import math
import struct
import wave
from playwright.sync_api import sync_playwright

server = ThreadingHTTPServer(('127.0.0.1', 0), SimpleHTTPRequestHandler)
Thread(target=server.serve_forever, daemon=True).start()
fixture = BytesIO()
with wave.open(fixture, 'wb') as sample:
    sample.setparams((1, 2, 8000, 0, 'NONE', 'not compressed'))
    sample.writeframes(b''.join(struct.pack('<h', int(5000 * math.sin(x / 4))) for x in range(48000)))
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium')
    page = browser.new_page(viewport={'width': 390, 'height': 844})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(f'http://127.0.0.1:{server.server_port}')
    assert page.locator('#beat-status').inner_text() == '未同步'
    page.locator('#file').set_input_files({'name': 'test.wav', 'mimeType': 'audio/wav', 'buffer': fixture.getvalue()})
    assert page.locator('#hit-key').input_value() == 'F'
    page.locator('#track').click()
    page.keyboard.press('Space')
    assert page.locator('#count').inner_text() == '00'
    assert page.evaluate("document.querySelector('audio').paused")
    page.locator('#tap-sync').click()
    page.wait_for_function("document.querySelector('audio').currentTime > .18")
    page.locator('#mark').click()
    clock = "(t) => document.querySelector('audio').currentTime >= t"
    for beat in [.45, .95, 1.45, 1.95]:
        page.wait_for_function(clock, arg=beat)
        page.keyboard.press('f')
    assert page.locator('#beat-status').inner_text() == '已按手点校准', page.locator('#feedback').inner_text()
    assert page.locator('#count').inner_text() == '01'
    assert 110 <= float(page.locator('#bpm').input_value()) <= 130
    page.wait_for_function("document.querySelector('.beat-lights .lit')?.textContent === '1'")
    page.locator('#play').click()
    assert page.locator('.beat-lights .lit').count() == 1
    assert page.locator('#tap-cancel').is_hidden()
    page.locator('#hit-key').select_option('J')
    assert page.locator('#mark-key-badge').inner_text() == 'J'
    page.locator('#track').click()
    page.keyboard.press('f')
    page.keyboard.press('Space')
    assert page.locator('#count').inner_text() == '01'
    page.keyboard.press('j')
    assert page.locator('#count').inner_text() == '02'
    assert not errors, errors
    assert page.evaluate('document.documentElement.scrollWidth === innerWidth')
    browser.close()
print('PASS: actual Chromium WAV playback, four taps, loop, raw marker, pause, 390px layout.')
