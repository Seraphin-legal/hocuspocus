import map from 'lib0/dist/map.cjs'
import WebSocket from 'ws'
import { createServer } from 'http'
import Document from './Document.js'
import Connection from './Connection.js'

class Hocuspocus {

  configuration = {

    debounce: true,
    debounceMaxWait: 10000,
    httpServer: null,
    persistence: null,
    port: 80,
    timeout: 30000,

    onChange: data => {},
    onConnect: (data, resolve) => resolve(),
    onDisconnect: data => {},
    onJoinDocument: (data, resolve) => resolve(),

  }

  httpServer

  websocketServer

  documents = new Map()

  debounceTimeout

  debounceStart

  /**
   * Constructor
   */
  constructor() {
    this.httpServer = this.configuration.httpServer
      ? this.configuration.httpServer
      : createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/plain' })
        response.end('OK')
      })

    this.websocketServer = new WebSocket.Server({ noServer: true })

    this.httpServer.on('upgrade', this.handleUpgrade.bind(this))
    this.websocketServer.on('connection', this.handleConnection.bind(this))
  }

  /**
   * Configure the server
   * @param configuration
   * @returns {Hocuspocus}
   */
  configure(configuration) {
    this.configuration = {
      ...this.configuration,
      ...configuration,
    }

    return this
  }

  /**
   * Start the server
   */
  listen() {
    this.httpServer.listen(this.configuration.port, () => {
      console.log(`Listening on http://127.0.0.1:${this.configuration.port}`)
    })
  }

  /**
   * Handle upgrade request
   * @param request
   * @param socket
   * @param head
   * @private
   */
  handleUpgrade(request, socket, head) {
    const data = {
      requestHeaders: request.headers,
    }

    this.websocketServer.handleUpgrade(request, socket, head, connection => {

      new Promise((resolve, reject) => {
        this.configuration.onConnect(data, resolve, reject)
      })
        .then(context => {
          this.websocketServer.emit('connection', connection, request, context)
        })
        .catch(() => {
          connection.close()
          console.log('unauthenticated')
        })

    })
  }

  /**
   * Handle the incoming connection
   * @param incoming
   * @param request
   * @param context
   * @private
   */
  handleConnection(incoming, request, context = null) {
    console.log(`New connection to ${request.url}`)

    const document = this.createDocument(request)
    const connection = this.createConnection(incoming, request, document, context)

    const data = {
      clientsCount: document.connectionsCount(),
      context,
      document,
      documentName: document.name,
      requestHeaders: request.headers,
    }

    new Promise((resolve, reject) => {
      this.configuration.onJoinDocument(data, resolve, reject)
    })
      .catch(() => {
        connection.close()
        console.log(`Connection to ${request.url} was terminated by script`)
      })
  }

  /**
   * Handle update of the given document
   * @param document
   * @param request
   * @returns {*}
   */
  handleDocumentUpdate(document, request) {
    const data = {
      clientsCount: document.connectionsCount(),
      document,
      documentName: document.name,
      requestHeaders: request.headers,
    }

    if (!this.configuration.debounce) {
      this.configuration.onChange(data)
      return
    }

    if (!this.debounceStart) {
      this.debounceStart = this.now()
    }

    if (this.now() - this.debounceStart >= this.configuration.debounceMaxWait) {
      this.configuration.onChange(data)
      this.debounceStart = null
      return
    }

    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout)
    }

    this.debounceTimeout = setTimeout(
      () => this.configuration.onChange(data),
      this.debounceDuration,
    )
  }

  /**
   * Create a new document by the given request
   * @param request
   * @private
   */
  createDocument(request) {
    const documentName = request.url.slice(1).split('?')[0]

    return map.setIfUndefined(this.documents, documentName, () => {
      const document = new Document(documentName)

      document.onUpdate(document => this.handleDocumentUpdate(document, request))

      if (this.configuration.persistence) {
        this.configuration.persistence.connect(documentName, document)
      }

      this.documents.set(documentName, document)

      return document
    })
  }

  /**
   * Create a new connection by the given request and document
   * @param connection
   * @param request
   * @param document
   * @param context
   * @returns {Connection}
   * @private
   */
  createConnection(connection, request, document, context = null) {
    return new Connection(
      connection,
      request,
      document,
      this.configuration.timeout,
      context,
    )
      .onClose(document => {

        this.configuration.onDisconnect({
          document,
          documentName: document.name,
          requestHeaders: request.headers,
          clientsCount: document.connectionsCount(),
        })

        if (document.connectionsCount() > 0 || this.configuration.persistence === null) {
          return
        }

        this.configuration.persistence.store(document.name, document).then(() => {
          document.destroy()
          console.log(`Document ${document.name} stored.`)
        })

        this.documents.delete(document.name)
      })
  }

  /**
   * Get the current process time in milliseconds
   * @returns {number}
   */
  now() {
    const hrTime = process.hrtime()
    return Math.round(hrTime[0] * 1000 + hrTime[1] / 1000000)
  }

  /**
   * Get debounce duration
   * @returns {number}
   */
  get debounceDuration() {
    return Number.isNaN(this.configuration.debounce)
      ? 2000
      : this.configuration.debounce
  }
}

export const Server = new Hocuspocus()