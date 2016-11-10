import delay from './helpers/delay';
import EventTarget from './event-target';
import networkBridge from './network-bridge';
import CLOSE_CODES from './helpers/close-codes';
import log from './helpers/logger';
import { createEvent, createMessageEvent, createCloseEvent } from './event-factory';
import { normalizeProtocol, normalizeUrl } from './utils/normalize';

/*
* The main websocket class which is designed to mimick the native WebSocket class as close
* as possible.
*
* https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
*/
class WebSocket extends EventTarget {

  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url, protocol = '') {
    super();

    if (!url) {
      throw new TypeError('Failed to construct \'WebSocket\': 1 argument required, but only 0 present.');
    }
    else if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      throw new Error(`Failed to construct 'WebSocket': The URL '${String(url)}' is invalid.`);
    }

    this.binaryType = 'blob';
    this.url = normalizeUrl(url);
    this.readyState = WebSocket.CONNECTING;
    this.protocol = normalizeProtocol(protocol);

    /*
    * In order to capture the callback function we need to define custom setters.
    * To illustrate:
    *   mySocket.onopen = function() { alert(true) };
    *
    * The only way to capture that function and hold onto it for later is with the
    * below code:
    */
    Object.defineProperties(this, {
      onopen: {
        configurable: true,
        enumerable: true,
        get() { return this.listeners.open; },
        set(listener) {
          this.addEventListener('open', listener);
        }
      },
      onmessage: {
        configurable: true,
        enumerable: true,
        get() { return this.listeners.message; },
        set(listener) {
          this.addEventListener('message', listener);
        }
      },
      onclose: {
        configurable: true,
        enumerable: true,
        get() { return this.listeners.close; },
        set(listener) {
          this.addEventListener('close', listener);
        }
      },
      onerror: {
        configurable: true,
        enumerable: true,
        get() { return this.listeners.error; },
        set(listener) {
          this.addEventListener('error', listener);
        }
      },
      binaryType: {
        set(value) {
          if (['blob', 'arraybuffer'].indexOf(value) !== -1) {
            this.binaryType = value;
          }
          else {
            console.warn(`The provided value '${value.toString()}' is not a valid enum value of type BinaryType`);
          }
        }
      }
    });

    /*
    * This delay is needed so that we dont trigger an event before the callbacks have been
    * setup. For example:
    *
    * var socket = new WebSocket('ws://localhost');
    *
    * // If we dont have the delay then the event would be triggered right here and this is
    * // before the onopen had a chance to register itself.
    *
    * socket.onopen = () => { // this would never be called };
    *
    * // and with the delay the event gets triggered here after all of the callbacks have been
    * // registered :-)
    */
    delay(function delayCallback() {
      const server = networkBridge.attachWebSocket(this, this.url);

      if (server) {
        const { options } = server;

        if (options.verifyClient && typeof options.verifyClient === 'function' && !options.verifyClient()) {
          this.readyState = WebSocket.CLOSED;

          log(
            'error',
            `WebSocket connection to '${this.url}' failed: HTTP Authentication failed; no valid credentials available`
          );

          networkBridge.removeWebSocket(this, this.url);
          this.dispatchEvent(createEvent({ type: 'error', target: this }));
          this.dispatchEvent(createCloseEvent({ type: 'close', target: this, code: CLOSE_CODES.CLOSE_NORMAL }));
        } else {
          this.readyState = WebSocket.OPEN;
          server.dispatchEvent(createEvent({ type: 'connection' }), server, this);
          this.dispatchEvent(createEvent({ type: 'open', target: this }));
        }
      } else {
        this.readyState = WebSocket.CLOSED;
        this.dispatchEvent(createEvent({ type: 'error', target: this }));
        this.dispatchEvent(createCloseEvent({ type: 'close', target: this, code: CLOSE_CODES.CLOSE_NORMAL }));

        log('error', `WebSocket connection to '${this.url}' failed`);
      }
    }, this);
  }

  /*
  * Transmits data to the server over the WebSocket connection.
  *
  * https://developer.mozilla.org/en-US/docs/Web/API/WebSocket#send()
  */
  send(data) {
    if (this.readyState === WebSocket.CLOSING || this.readyState === WebSocket.CLOSED) {
      throw new Error('WebSocket is already in CLOSING or CLOSED state');
    }

    const messageEvent = createMessageEvent({
      type: 'message',
      origin: this.url,
      data
    });

    const server = networkBridge.serverLookup(this.url);

    if (server) {
      server.dispatchEvent(messageEvent, data);
    }
  }

  /*
  * Closes the WebSocket connection or connection attempt, if any.
  * If the connection is already CLOSED, this method does nothing.
  *
  * https://developer.mozilla.org/en-US/docs/Web/API/WebSocket#close()
  */
  close(code, reason) {
    if (Number(code) === NaN) {
      code = 0;
    }

    if (code !== 1000 && (code < 3000 || code > 4999)) {
      throw new Error(`Failed to execute 'close' on 'WebSocket': The code must be either 1000, or between 3000 and 4999. ${code} is neither`); // Should be DOMException
    }

    if (this.readyState !== WebSocket.OPEN) { return undefined; }

    const server = networkBridge.serverLookup(this.url);
    const closeEvent = createCloseEvent({
      type: 'close',
      target: this,
      code: CLOSE_CODES.CLOSE_NORMAL
    });

    networkBridge.removeWebSocket(this, this.url);

    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(closeEvent);

    if (server) {
      server.dispatchEvent(closeEvent, server);
    }
  }

  static toString() {
    return 'function WebSocket() { [native code] }';
  }

  toString() {
    return '[object WebSocket]';
  }
}

export default WebSocket;
