(function webpackUniversalModuleDefinition(root, factory) {
	if(typeof exports === 'object' && typeof module === 'object')
		module.exports = factory();
	else if(typeof define === 'function' && define.amd)
		define([], factory);
	else if(typeof exports === 'object')
		exports["Automerge"] = factory();
	else
		root["Automerge"] = factory();
})(this, function() {
return /******/ (function() { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ "./backend/backend.js":
/*!****************************!*\
  !*** ./backend/backend.js ***!
  \****************************/
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

const { Map, List } = __webpack_require__(/*! immutable */ "./node_modules/immutable/dist/immutable.js")
const OpSet = __webpack_require__(/*! ./op_set */ "./backend/op_set.js")
const { splitContainers, encodeChange, decodeChanges, encodeDocument, constructPatch, BackendDoc } = __webpack_require__(/*! ./columnar */ "./backend/columnar.js")
const { backendState } = __webpack_require__(/*! ./util */ "./backend/util.js")

// Feature flag: false uses old Immutable.js-based backend data structures, true uses new
// byte-array-based data structures. New data structures are not yet fully working.
const USE_NEW_BACKEND = false

function numHashesByActor(state, actorId) {
  if (USE_NEW_BACKEND) {
    return (state.hashesByActor[actorId] || []).length
  } else {
    return state.getIn(['opSet', 'states', actorId], List()).size
  }
}

function hashByActor(state, actorId, index) {
  if (USE_NEW_BACKEND) {
    return (state.hashesByActor[actorId] || [])[index]
  } else {
    return state.getIn(['opSet', 'states', actorId, index])
  }
}

/**
 * Returns an empty node state.
 */
function init() {
  if (USE_NEW_BACKEND) {
    return {state: new BackendDoc(), heads: []}
  } else {
    return {state: Map({opSet: OpSet.init(), objectIds: Map()}), heads: []}
  }
}

function clone(backend) {
  if (USE_NEW_BACKEND) {
    return {state: backendState(backend).clone(), heads: backend.heads}
  } else {
    return {state: backendState(backend), heads: backend.heads}
  }
}

function free(backend) {
  backend.state = null
  backend.frozen = true
}

/**
 * Constructs a patch object from the current node state `state` and the
 * object modifications `diffs`.
 */
function makePatch(state, diffs, request, isIncremental) {
  const clock = state.getIn(['opSet', 'states']).map(seqs => seqs.size).toObject()
  const deps  = state.getIn(['opSet', 'deps']).toArray().sort()
  const maxOp = state.getIn(['opSet', 'maxOp'], 0)
  const pendingChanges = OpSet.getMissingDeps(state.get('opSet')).length
  const patch = {clock, deps, diffs, maxOp, pendingChanges}

  if (isIncremental && request) {
    patch.actor = request.actor
    patch.seq   = request.seq

    // Omit the local actor's own last change from deps
    const lastHash = state.getIn(['opSet', 'states', request.actor, request.seq - 1])
    patch.deps = patch.deps.filter(dep => dep !== lastHash)
  }
  return patch
}

/**
 * The implementation behind `applyChanges()`, `applyLocalChange()`, and
 * `loadChanges()`.
 */
function apply(state, changes, request, isIncremental) {
  let diffs = isIncremental ? {objectId: '_root', type: 'map', props: {}} : null
  let opSet = state.get('opSet')
  for (let change of changes) {
    for (let chunk of splitContainers(change)) {
      if (request) {
        opSet = OpSet.addLocalChange(opSet, chunk, diffs)
      } else {
        opSet = OpSet.addChange(opSet, chunk, diffs)
      }
    }
  }

  OpSet.finalizePatch(diffs)
  state = state.set('opSet', opSet)

  return [state, isIncremental ? makePatch(state, diffs, request, true) : null]
}

/**
 * Applies a list of `changes` from remote nodes to the node state `backend`.
 * Returns a two-element array `[state, patch]` where `state` is the updated
 * node state, and `patch` describes the modifications that need to be made
 * to the document objects to reflect these changes.
 */
function applyChanges(backend, changes) {
  if (USE_NEW_BACKEND) {
    const state = backendState(backend)
    const patch = state.applyChanges(changes)
    backend.frozen = true
    return [{state, heads: state.heads}, patch]
  } else {
    let [state, patch] = apply(backendState(backend), changes, null, true)
    const heads = OpSet.getHeads(state.get('opSet'))
    backend.frozen = true
    return [{state, heads}, patch]
  }
}

/**
 * Takes a single change request `request` made by the local user, and applies
 * it to the node state `backend`. Returns a three-element array `[backend, patch, binaryChange]`
 * where `backend` is the updated node state,`patch` confirms the
 * modifications to the document objects, and `binaryChange` is a binary-encoded form of
 * the change submitted.
 */
function applyLocalChange(backend, change) {
  const state = backendState(backend)
  if (change.seq <= numHashesByActor(state, change.actor)) {
    throw new RangeError('Change request has already been applied')
  }

  // Add the local actor's last change hash to deps. We do this because when frontend
  // and backend are on separate threads, the frontend may fire off several local
  // changes in sequence before getting a response from the backend; since the binary
  // encoding and hashing is done by the backend, the frontend does not know the hash
  // of its own last change in this case. Rather than handle this situation as a
  // special case, we say that the frontend includes only specifies other actors'
  // deps in changes it generates, and the dependency from the local actor's last
  // change is always added here in the backend.
  //
  // Strictly speaking, we should check whether the local actor's last change is
  // indirectly reachable through a different actor's change; in that case, it is not
  // necessary to add this dependency. However, it doesn't do any harm either (only
  // using a few extra bytes of storage).
  if (change.seq > 1) {
    const lastHash = hashByActor(state, change.actor, change.seq - 2)
    if (!lastHash) {
      throw new RangeError(`Cannot find hash of localChange before seq=${change.seq}`)
    }
    let deps = {[lastHash]: true}
    for (let hash of change.deps) deps[hash] = true
    change.deps = Object.keys(deps).sort()
  }

  const binaryChange = encodeChange(change)

  if (USE_NEW_BACKEND) {
    const patch = state.applyChanges([binaryChange], true)
    backend.frozen = true

    // On the patch we send out, omit the last local change hash
    const lastHash = hashByActor(state, change.actor, change.seq - 1)
    patch.deps = patch.deps.filter(head => head !== lastHash)
    return [{state, heads: state.heads}, patch, binaryChange]

  } else {
    const request = {actor: change.actor, seq: change.seq}
    const [state2, patch] = apply(state, [binaryChange], request, true)
    const heads = OpSet.getHeads(state2.get('opSet'))
    backend.frozen = true
    return [{state: state2, heads}, patch, binaryChange]
  }
}

/**
 * Returns the state of the document serialised to an Uint8Array.
 */
function save(backend) {
  if (USE_NEW_BACKEND) {
    return backendState(backend).save()
  } else {
    return encodeDocument(getAllChanges(backend))
  }
}

/**
 * Loads the document and/or changes contained in an Uint8Array, and returns a
 * backend initialised with this state.
 */
function load(data) {
  if (USE_NEW_BACKEND) {
    const state = new BackendDoc(data)
    return {state, heads: state.heads}
  } else {
    // Reconstruct the original change history that created the document.
    // It's a bit silly to convert to and from the binary encoding several times...!
    const binaryChanges = decodeChanges([data]).map(encodeChange)
    return loadChanges(init(), binaryChanges)
  }
}

/**
 * Applies a list of `changes` to the node state `backend`, and returns the updated
 * state with those changes incorporated. Unlike `applyChanges()`, this function
 * does not produce a patch describing the incremental modifications, making it
 * a little faster when loading a document from disk. When all the changes have
 * been loaded, you can use `getPatch()` to construct the latest document state.
 */
function loadChanges(backend, changes) {
  const state = backendState(backend)
  if (USE_NEW_BACKEND) {
    state.applyChanges(changes)
    backend.frozen = true
    return {state, heads: state.heads}
  } else {
    const [newState] = apply(state, changes, null, false)
    backend.frozen = true
    return {state: newState, heads: OpSet.getHeads(newState.get('opSet'))}
  }
}

/**
 * Returns a patch that, when applied to an empty document, constructs the
 * document tree in the state described by the node state `backend`.
 */
function getPatch(backend) {
  const state = backendState(backend)
  if (USE_NEW_BACKEND) {
    const diffs = constructPatch(state.save())
    return {
      maxOp: state.maxOp,
      clock: state.clock,
      deps: state.heads,
      diffs
    }
  } else {
    const diffs = constructPatch(save(backend))
    return makePatch(state, diffs, null, false)
  }
}

/**
 * Returns an array of hashes of the current "head" changes (i.e. those changes
 * that no other change depends on).
 */
function getHeads(backend) {
  return backend.heads
}

/**
 * Returns the full history of changes that have been applied to a document.
 */
function getAllChanges(backend) {
  return getChanges(backend, [])
}

/**
 * Returns all changes that are newer than or concurrent to the changes
 * identified by the hashes in `haveDeps`. If `haveDeps` is an empty array, all
 * changes are returned. Throws an exception if any of the given hashes is unknown.
 */
function getChanges(backend, haveDeps) {
  if (!Array.isArray(haveDeps)) {
    throw new TypeError('Pass an array of hashes to Backend.getChanges()')
  }

  const state = backendState(backend)
  if (USE_NEW_BACKEND) {
    return state.getChanges(haveDeps)
  } else {
    return OpSet.getMissingChanges(state.get('opSet'), List(haveDeps))
  }
}

/**
 * Returns all changes that are present in `backend2` but not in `backend1`.
 * Intended for use in situations where the two backends are for different actors.
 * To get the changes added between an older and a newer document state of the same
 * actor, use `getChanges()` instead. `getChangesAdded()` throws an exception if
 * one of the backend states is frozen (i.e. if it is not the latest state of that
 * backend instance; this distinction matters when the backend is mutable).
 */
function getChangesAdded(backend1, backend2) {
  const opSet1 = backendState(backend1).get('opSet')
  const opSet2 = backendState(backend2).get('opSet')
  return OpSet.getChangesAdded(opSet1, opSet2)
}

/**
 * If the backend has applied a change with the given `hash` (given as a
 * hexadecimal string), returns that change (as a byte array). Returns undefined
 * if no change with that hash has been applied. A change with missing
 * dependencies does not count as having been applied.
 */
function getChangeByHash(backend, hash) {
  const state = backendState(backend)
  if (USE_NEW_BACKEND) {
    return state.getChangeByHash(hash)
  } else {
    return OpSet.getChangeByHash(state.get('opSet'), hash)
  }
}

/**
 * Returns the hashes of any missing dependencies, i.e. where we have applied a
 * change that has a dependency on a change we have not seen.
 *
 * If the argument `heads` is given (an array of hexadecimal strings representing
 * hashes as returned by `getHeads()`), this function also ensures that all of
 * those hashes resolve to either a change that has been applied to the document,
 * or that has been enqueued for later application once missing dependencies have
 * arrived. Any missing heads hashes are included in the returned array.
 */
function getMissingDeps(backend, heads = []) {
  const state = backendState(backend)
  if (USE_NEW_BACKEND) {
    return state.getMissingDeps(heads)
  } else {
    return OpSet.getMissingDeps(state.get('opSet'), heads)
  }
}

module.exports = {
  init, clone, free, applyChanges, applyLocalChange, save, load, loadChanges, getPatch,
  getHeads, getAllChanges, getChanges, getChangesAdded, getChangeByHash, getMissingDeps
}


/***/ }),

/***/ "./backend/columnar.js":
/*!*****************************!*\
  !*** ./backend/columnar.js ***!
  \*****************************/
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

const pako = __webpack_require__(/*! pako */ "./node_modules/pako/index.js")
const { copyObject, parseOpId, equalBytes } = __webpack_require__(/*! ../src/common */ "./src/common.js")
const {
  utf8ToString, hexStringToBytes, bytesToHexString,
  Encoder, Decoder, RLEEncoder, RLEDecoder, DeltaEncoder, DeltaDecoder, BooleanEncoder, BooleanDecoder
} = __webpack_require__(/*! ./encoding */ "./backend/encoding.js")

// Maybe we should be using the platform's built-in hash implementation?
// Node has the crypto module: https://nodejs.org/api/crypto.html and browsers have
// https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest
// However, the WebCrypto API is asynchronous (returns promises), which would
// force all our APIs to become asynchronous as well, which would be annoying.
//
// I think on balance, it's safe enough to use a random library off npm:
// - We only need one hash function (not a full suite of crypto algorithms);
// - SHA256 is quite simple and has fairly few opportunities for subtle bugs
//   (compared to asymmetric cryptography anyway);
// - It does not need a secure source of random bits and does not need to be
//   constant-time;
// - I have reviewed the source code and it seems pretty reasonable.
const { Hash } = __webpack_require__(/*! fast-sha256 */ "./node_modules/fast-sha256/sha256.js")

// These bytes don't mean anything, they were generated randomly
const MAGIC_BYTES = new Uint8Array([0x85, 0x6f, 0x4a, 0x83])

const CHUNK_TYPE_DOCUMENT = 0
const CHUNK_TYPE_CHANGE = 1
const CHUNK_TYPE_DEFLATE = 2 // like CHUNK_TYPE_CHANGE but with DEFLATE compression

// Minimum number of bytes in a value before we enable DEFLATE compression (there is no point
// compressing very short values since compression may actually make them bigger)
const DEFLATE_MIN_SIZE = 256

// The least-significant 3 bits of a columnId indicate its datatype
const COLUMN_TYPE = {
  GROUP_CARD: 0, ACTOR_ID: 1, INT_RLE: 2, INT_DELTA: 3, BOOLEAN: 4,
  STRING_RLE: 5, VALUE_LEN: 6, VALUE_RAW: 7
}

// The 4th-least-significant bit of a columnId is set if the column is DEFLATE-compressed
const COLUMN_TYPE_DEFLATE = 8

// In the values in a column of type VALUE_LEN, the bottom four bits indicate the type of the value,
// one of the following types in VALUE_TYPE. The higher bits indicate the length of the value in the
// associated VALUE_RAW column (in bytes).
const VALUE_TYPE = {
  NULL: 0, FALSE: 1, TRUE: 2, LEB128_UINT: 3, LEB128_INT: 4, IEEE754: 5,
  UTF8: 6, BYTES: 7, COUNTER: 8, TIMESTAMP: 9, MIN_UNKNOWN: 10, MAX_UNKNOWN: 15
}

// make* actions must be at even-numbered indexes in this list
const ACTIONS = ['makeMap', 'set', 'makeList', 'del', 'makeText', 'inc', 'makeTable', 'link']

const OBJECT_TYPE = {makeMap: 'map', makeList: 'list', makeText: 'text', makeTable: 'table'}

const COMMON_COLUMNS = {
  objActor:  0 << 4 | COLUMN_TYPE.ACTOR_ID,
  objCtr:    0 << 4 | COLUMN_TYPE.INT_RLE,
  keyActor:  1 << 4 | COLUMN_TYPE.ACTOR_ID,
  keyCtr:    1 << 4 | COLUMN_TYPE.INT_DELTA,
  keyStr:    1 << 4 | COLUMN_TYPE.STRING_RLE,
  idActor:   2 << 4 | COLUMN_TYPE.ACTOR_ID,
  idCtr:     2 << 4 | COLUMN_TYPE.INT_DELTA,
  insert:    3 << 4 | COLUMN_TYPE.BOOLEAN,
  action:    4 << 4 | COLUMN_TYPE.INT_RLE,
  valLen:    5 << 4 | COLUMN_TYPE.VALUE_LEN,
  valRaw:    5 << 4 | COLUMN_TYPE.VALUE_RAW,
  chldActor: 6 << 4 | COLUMN_TYPE.ACTOR_ID,
  chldCtr:   6 << 4 | COLUMN_TYPE.INT_DELTA
}

const CHANGE_COLUMNS = Object.assign({
  predNum:   7 << 4 | COLUMN_TYPE.GROUP_CARD,
  predActor: 7 << 4 | COLUMN_TYPE.ACTOR_ID,
  predCtr:   7 << 4 | COLUMN_TYPE.INT_DELTA
}, COMMON_COLUMNS)

const DOC_OPS_COLUMNS = Object.assign({
  succNum:   8 << 4 | COLUMN_TYPE.GROUP_CARD,
  succActor: 8 << 4 | COLUMN_TYPE.ACTOR_ID,
  succCtr:   8 << 4 | COLUMN_TYPE.INT_DELTA
}, COMMON_COLUMNS)

const DOC_OPS_COLUMNS_REV = Object.entries(DOC_OPS_COLUMNS)
  .reduce((acc, [k, v]) => { acc[v] = k; return acc }, [])

const DOCUMENT_COLUMNS = {
  actor:     0 << 4 | COLUMN_TYPE.ACTOR_ID,
  seq:       0 << 4 | COLUMN_TYPE.INT_DELTA,
  maxOp:     1 << 4 | COLUMN_TYPE.INT_DELTA,
  time:      2 << 4 | COLUMN_TYPE.INT_DELTA,
  message:   3 << 4 | COLUMN_TYPE.STRING_RLE,
  depsNum:   4 << 4 | COLUMN_TYPE.GROUP_CARD,
  depsIndex: 4 << 4 | COLUMN_TYPE.INT_DELTA,
  extraLen:  5 << 4 | COLUMN_TYPE.VALUE_LEN,
  extraRaw:  5 << 4 | COLUMN_TYPE.VALUE_RAW
}

/**
 * Updates `objectTree`, which is a tree of nested objects, so that afterwards
 * `objectTree[path[0]][path[1]][...] === value`. Only the root object is mutated, whereas any
 * nested objects are copied before updating. This means that once the root object has been
 * shallow-copied, this function can be used to update it without mutating the previous version.
 */
function deepCopyUpdate(objectTree, path, value) {
  if (path.length === 1) {
    objectTree[path[0]] = value
  } else {
    let child = Object.assign({}, objectTree[path[0]])
    deepCopyUpdate(child, path.slice(1), value)
    objectTree[path[0]] = child
  }
}

/**
 * Maps an opId of the form {counter: 12345, actorId: 'someActorId'} to the form
 * {counter: 12345, actorNum: 123, actorId: 'someActorId'}, where the actorNum
 * is the index into the `actorIds` array.
 */
function actorIdToActorNum(opId, actorIds) {
  if (!opId || !opId.actorId) return opId
  const counter = opId.counter
  const actorNum = actorIds.indexOf(opId.actorId)
  if (actorNum < 0) throw new RangeError('missing actorId') // should not happen
  return {counter, actorNum, actorId: opId.actorId}
}

/**
 * Comparison function to pass to Array.sort(), which compares two opIds in the
 * form produced by `actorIdToActorNum` so that they are sorted in increasing
 * Lamport timestamp order (sorted first by counter, then by actorId).
 */
function compareParsedOpIds(id1, id2) {
  if (id1.counter < id2.counter) return -1
  if (id1.counter > id2.counter) return +1
  if (id1.actorId < id2.actorId) return -1
  if (id1.actorId > id2.actorId) return +1
  return 0
}

/**
 * Takes `changes`, an array of changes (represented as JS objects). Returns an
 * object `{changes, actorIds}`, where `changes` is a copy of the argument in
 * which all string opIds have been replaced with `{counter, actorNum}` objects,
 * and where `actorIds` is a lexicographically sorted array of actor IDs occurring
 * in any of the operations. `actorNum` is an index into that array of actorIds.
 * If `single` is true, the actorId of the author of the change is moved to the
 * beginning of the array of actorIds, so that `actorNum` is zero when referencing
 * the author of the change itself. This special-casing is omitted if `single` is
 * false.
 */
function parseAllOpIds(changes, single) {
  const actors = {}, newChanges = []
  for (let change of changes) {
    change = copyObject(change)
    actors[change.actor] = true
    change.ops = expandMultiOps(change.ops, change.startOp, change.actor)
    change.ops = change.ops.map(op => {
      op = copyObject(op)
      if (op.obj !== '_root') op.obj = parseOpId(op.obj)
      if (op.elemId && op.elemId !== '_head') op.elemId = parseOpId(op.elemId)
      if (op.child) op.child = parseOpId(op.child)
      if (op.pred) op.pred = op.pred.map(parseOpId)
      if (op.obj.actorId) actors[op.obj.actorId] = true
      if (op.elemId && op.elemId.actorId) actors[op.elemId.actorId] = true
      if (op.child && op.child.actorId) actors[op.child.actorId] = true
      for (let pred of op.pred) actors[pred.actorId] = true
      return op
    })
    newChanges.push(change)
  }

  let actorIds = Object.keys(actors).sort()
  if (single) {
    actorIds = [changes[0].actor].concat(actorIds.filter(actor => actor !== changes[0].actor))
  }
  for (let change of newChanges) {
    change.actorNum = actorIds.indexOf(change.actor)
    for (let i = 0; i < change.ops.length; i++) {
      let op = change.ops[i]
      op.id = {counter: change.startOp + i, actorNum: change.actorNum, actorId: change.actor}
      op.obj = actorIdToActorNum(op.obj, actorIds)
      op.elemId = actorIdToActorNum(op.elemId, actorIds)
      op.child = actorIdToActorNum(op.child, actorIds)
      op.pred = op.pred.map(pred => actorIdToActorNum(pred, actorIds))
    }
  }
  return {changes: newChanges, actorIds}
}

/**
 * Encodes the `obj` property of operation `op` into the two columns
 * `objActor` and `objCtr`.
 */
function encodeObjectId(op, columns) {
  if (op.obj === '_root') {
    columns.objActor.appendValue(null)
    columns.objCtr.appendValue(null)
  } else if (op.obj.actorNum >= 0 && op.obj.counter > 0) {
    columns.objActor.appendValue(op.obj.actorNum)
    columns.objCtr.appendValue(op.obj.counter)
  } else {
    throw new RangeError(`Unexpected objectId reference: ${JSON.stringify(op.obj)}`)
  }
}

/**
 * Encodes the `key` and `elemId` properties of operation `op` into the three
 * columns `keyActor`, `keyCtr`, and `keyStr`.
 */
function encodeOperationKey(op, columns) {
  if (op.key) {
    columns.keyActor.appendValue(null)
    columns.keyCtr.appendValue(null)
    columns.keyStr.appendValue(op.key)
  } else if (op.elemId === '_head' && op.insert) {
    columns.keyActor.appendValue(null)
    columns.keyCtr.appendValue(0)
    columns.keyStr.appendValue(null)
  } else if (op.elemId && op.elemId.actorNum >= 0 && op.elemId.counter > 0) {
    columns.keyActor.appendValue(op.elemId.actorNum)
    columns.keyCtr.appendValue(op.elemId.counter)
    columns.keyStr.appendValue(null)
  } else {
    throw new RangeError(`Unexpected operation key: ${JSON.stringify(op)}`)
  }
}

/**
 * Encodes the `action` property of operation `op` into the `action` column.
 */
function encodeOperationAction(op, columns) {
  const actionCode = ACTIONS.indexOf(op.action)
  if (actionCode >= 0) {
    columns.action.appendValue(actionCode)
  } else if (typeof op.action === 'number') {
    columns.action.appendValue(op.action)
  } else {
    throw new RangeError(`Unexpected operation action: ${op.action}`)
  }
}

/**
 * Given the datatype for a number, determine the typeTag and the value to encode
 * otherwise guess
 */
function getNumberTypeAndValue(op) {
  switch (op.datatype) {
    case "counter":
      return [ VALUE_TYPE.COUNTER, op.value ]
    case "timestamp":
      return [ VALUE_TYPE.TIMESTAMP, op.value ]
    case "uint":
      return [ VALUE_TYPE.LEB128_UINT, op.value ]
    case "int":
      return [ VALUE_TYPE.LEB128_INT, op.value ]
    case "float64": {
      const buf64 = new ArrayBuffer(8), view64 = new DataView(buf64)
      view64.setFloat64(0, op.value, true)
      return [ VALUE_TYPE.IEEE754,  new Uint8Array(buf64) ]
    }
    default:
      // increment operators get resolved here ...
      if (Number.isInteger(op.value) && op.value <= Number.MAX_SAFE_INTEGER && op.value >= Number.MIN_SAFE_INTEGER) {
        return [ VALUE_TYPE.LEB128_INT, op.value ]
      } else {
        const buf64 = new ArrayBuffer(8), view64 = new DataView(buf64)
        view64.setFloat64(0, op.value, true)
        return [ VALUE_TYPE.IEEE754,  new Uint8Array(buf64) ]
      }
  }
}

/**
 * Encodes the `value` property of operation `op` into the two columns
 * `valLen` and `valRaw`.
 */
function encodeValue(op, columns) {
  if ((op.action !== 'set' && op.action !== 'inc') || op.value === null) {
    columns.valLen.appendValue(VALUE_TYPE.NULL)
  } else if (op.value === false) {
    columns.valLen.appendValue(VALUE_TYPE.FALSE)
  } else if (op.value === true) {
    columns.valLen.appendValue(VALUE_TYPE.TRUE)
  } else if (typeof op.value === 'string') {
    const numBytes = columns.valRaw.appendRawString(op.value)
    columns.valLen.appendValue(numBytes << 4 | VALUE_TYPE.UTF8)
  } else if (ArrayBuffer.isView(op.value)) {
    const numBytes = columns.valRaw.appendRawBytes(new Uint8Array(op.value.buffer))
    columns.valLen.appendValue(numBytes << 4 | VALUE_TYPE.BYTES)
  } else if (typeof op.value === 'number') {
    let [typeTag, value] = getNumberTypeAndValue(op)
    let numBytes
    if (typeTag === VALUE_TYPE.LEB128_UINT) {
      numBytes = columns.valRaw.appendUint53(value)
    } else if (typeTag === VALUE_TYPE.IEEE754) {
      numBytes = columns.valRaw.appendRawBytes(value)
    } else {
      numBytes = columns.valRaw.appendInt53(value)
    }
    columns.valLen.appendValue(numBytes << 4 | typeTag)
  } else if (typeof op.datatype === 'number' && op.datatype >= VALUE_TYPE.MIN_UNKNOWN &&
             op.datatype <= VALUE_TYPE.MAX_UNKNOWN && op.value instanceof Uint8Array) {
    const numBytes = columns.valRaw.appendRawBytes(op.value)
    columns.valLen.appendValue(numBytes << 4 | op.datatype)
  } else if (op.datatype) {
      throw new RangeError(`Unknown datatype ${op.datatype} for value ${op.value}`)
  } else {
    throw new RangeError(`Unsupported value in operation: ${op.value}`)
  }
}

/**
 * Given `sizeTag` (an unsigned integer read from a VALUE_LEN column) and `bytes` (a Uint8Array
 * read from a VALUE_RAW column, with length `sizeTag >> 4`), this function returns an object of the
 * form `{value: value, datatype: datatypeTag}` where `value` is a JavaScript primitive datatype
 * corresponding to the value, and `datatypeTag` is a datatype annotation such as 'counter'.
 */
function decodeValue(sizeTag, bytes) {
  if (sizeTag === VALUE_TYPE.NULL) {
    return {value: null}
  } else if (sizeTag === VALUE_TYPE.FALSE) {
    return {value: false}
  } else if (sizeTag === VALUE_TYPE.TRUE) {
    return {value: true}
  } else if (sizeTag % 16 === VALUE_TYPE.UTF8) {
    return {value: utf8ToString(bytes)}
  } else {
    if (sizeTag % 16 === VALUE_TYPE.LEB128_UINT) {
      return {value: new Decoder(bytes).readUint53(), datatype: "uint"}
    } else if (sizeTag % 16 === VALUE_TYPE.LEB128_INT) {
      return {value: new Decoder(bytes).readInt53(), datatype: "int"}
    } else if (sizeTag % 16 === VALUE_TYPE.IEEE754) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      if (bytes.byteLength === 8) {
        return {value: view.getFloat64(0, true), datatype: "float64"}
      } else {
        throw new RangeError(`Invalid length for floating point number: ${bytes.byteLength}`)
      }
    } else if (sizeTag % 16 === VALUE_TYPE.COUNTER) {
      return {value: new Decoder(bytes).readInt53(), datatype: 'counter'}
    } else if (sizeTag % 16 === VALUE_TYPE.TIMESTAMP) {
      return {value: new Decoder(bytes).readInt53(), datatype: 'timestamp'}
    } else {
      return {value: bytes, datatype: sizeTag % 16}
    }
  }
}

/**
 * Reads one value from the column `columns[colIndex]` and interprets it based
 * on the column type. `actorIds` is a list of actors that appear in the change;
 * `actorIds[0]` is the actorId of the change's author. Mutates the `result`
 * object with the value, and returns the number of columns processed (this is 2
 * in the case of a pair of VALUE_LEN and VALUE_RAW columns, which are processed
 * in one go).
 */
function decodeValueColumns(columns, colIndex, actorIds, result) {
  const { columnId, columnName, decoder } = columns[colIndex]
  if (columnId % 8 === COLUMN_TYPE.VALUE_LEN && colIndex + 1 < columns.length &&
      columns[colIndex + 1].columnId === columnId + 1) {
    const sizeTag = decoder.readValue()
    const rawValue = columns[colIndex + 1].decoder.readRawBytes(sizeTag >> 4)
    const { value, datatype } = decodeValue(sizeTag, rawValue)
    result[columnName] = value
    if (datatype) result[columnName + '_datatype'] = datatype
    return 2
  } else if (columnId % 8 === COLUMN_TYPE.ACTOR_ID) {
    const actorNum = decoder.readValue()
    if (actorNum === null) {
      result[columnName] = null
    } else {
      if (!actorIds[actorNum]) throw new RangeError(`No actor index ${actorNum}`)
      result[columnName] = actorIds[actorNum]
    }
  } else {
    result[columnName] = decoder.readValue()
  }
  return 1
}

/**
 * Encodes an array of operations in a set of columns. The operations need to
 * be parsed with `parseAllOpIds()` beforehand. If `forDocument` is true, we use
 * the column structure of a whole document, otherwise we use the column
 * structure for an individual change. Returns an array of `{id, name, encoder}`
 * objects.
 */
function encodeOps(ops, forDocument) {
  const columns = {
    objActor  : new RLEEncoder('uint'),
    objCtr    : new RLEEncoder('uint'),
    keyActor  : new RLEEncoder('uint'),
    keyCtr    : new DeltaEncoder(),
    keyStr    : new RLEEncoder('utf8'),
    insert    : new BooleanEncoder(),
    action    : new RLEEncoder('uint'),
    valLen    : new RLEEncoder('uint'),
    valRaw    : new Encoder(),
    chldActor : new RLEEncoder('uint'),
    chldCtr   : new DeltaEncoder()
  }

  if (forDocument) {
    columns.idActor   = new RLEEncoder('uint')
    columns.idCtr     = new DeltaEncoder()
    columns.succNum   = new RLEEncoder('uint')
    columns.succActor = new RLEEncoder('uint')
    columns.succCtr   = new DeltaEncoder()
  } else {
    columns.predNum   = new RLEEncoder('uint')
    columns.predCtr   = new DeltaEncoder()
    columns.predActor = new RLEEncoder('uint')
  }

  for (let op of ops) {
    encodeObjectId(op, columns)
    encodeOperationKey(op, columns)
    columns.insert.appendValue(!!op.insert)
    encodeOperationAction(op, columns)
    encodeValue(op, columns)

    if (op.child && op.child.counter) {
      columns.chldActor.appendValue(op.child.actorNum)
      columns.chldCtr.appendValue(op.child.counter)
    } else {
      columns.chldActor.appendValue(null)
      columns.chldCtr.appendValue(null)
    }

    if (forDocument) {
      columns.idActor.appendValue(op.id.actorNum)
      columns.idCtr.appendValue(op.id.counter)
      columns.succNum.appendValue(op.succ.length)
      op.succ.sort(compareParsedOpIds)
      for (let i = 0; i < op.succ.length; i++) {
        columns.succActor.appendValue(op.succ[i].actorNum)
        columns.succCtr.appendValue(op.succ[i].counter)
      }
    } else {
      columns.predNum.appendValue(op.pred.length)
      op.pred.sort(compareParsedOpIds)
      for (let i = 0; i < op.pred.length; i++) {
        columns.predActor.appendValue(op.pred[i].actorNum)
        columns.predCtr.appendValue(op.pred[i].counter)
      }
    }
  }

  let columnList = []
  for (let [name, id] of Object.entries(forDocument ? DOC_OPS_COLUMNS : CHANGE_COLUMNS)) {
    if (columns[name]) columnList.push({id, name, encoder: columns[name]})
  }
  return columnList.sort((a, b) => a.id - b.id)
}

function validDatatype(value, datatype) {
  if (datatype === undefined) {
    return (typeof value === 'string' || typeof value === 'boolean' || value === null)
  } else {
    return typeof value === 'number'
  }
}

function expandMultiOps(ops, startOp, actor) {
  let opNum = startOp
  let expandedOps = []
  for (const op of ops) {
    if (op.action === 'set' && op.values && op.insert) {
      if (op.pred.length !== 0) throw new RangeError('multi-insert pred must be empty')
      let lastElemId = op.elemId
      const datatype = op.datatype
      for (const value of op.values) {
        if (!validDatatype(value, datatype)) throw new RangeError(`Decode failed: bad value/datatype association (${value},${datatype})`)
        expandedOps.push({action: 'set', obj: op.obj, elemId: lastElemId, datatype, value, pred: [], insert: true})
        lastElemId = `${opNum}@${actor}`
        opNum += 1
      }
    } else if (op.action === 'del' && op.multiOp > 1) {
      if (op.pred.length !== 1) throw new RangeError('multiOp deletion must have exactly one pred')
      const startElemId = parseOpId(op.elemId), startPred = parseOpId(op.pred[0])
      for (let i = 0; i < op.multiOp; i++) {
        const elemId = `${startElemId.counter + i}@${startElemId.actorId}`
        const pred = [`${startPred.counter + i}@${startPred.actorId}`]
        expandedOps.push({action: 'del', obj: op.obj, elemId, pred})
        opNum += 1
      }
    } else {
      expandedOps.push(op)
      opNum += 1
    }
  }
  return expandedOps
}

/**
 * Takes a change as decoded by `decodeColumns`, and changes it into the form
 * expected by the rest of the backend. If `forDocument` is true, we use the op
 * structure of a whole document, otherwise we use the op structure for an
 * individual change.
 */
function decodeOps(ops, forDocument) {
  const newOps = []
  for (let op of ops) {
    const obj = (op.objCtr === null) ? '_root' : `${op.objCtr}@${op.objActor}`
    const elemId = op.keyStr ? undefined : (op.keyCtr === 0 ? '_head' : `${op.keyCtr}@${op.keyActor}`)
    const action = ACTIONS[op.action] || op.action
    const newOp = elemId ? {obj, elemId, action} : {obj, key: op.keyStr, action}
    newOp.insert = !!op.insert
    if (ACTIONS[op.action] === 'set' || ACTIONS[op.action] === 'inc') {
      newOp.value = op.valLen
      if (op.valLen_datatype) newOp.datatype = op.valLen_datatype
    }
    if (!!op.chldCtr !== !!op.chldActor) {
      throw new RangeError(`Mismatched child columns: ${op.chldCtr} and ${op.chldActor}`)
    }
    if (op.chldCtr !== null) newOp.child = `${op.chldCtr}@${op.chldActor}`
    if (forDocument) {
      newOp.id = `${op.idCtr}@${op.idActor}`
      newOp.succ = op.succNum.map(succ => `${succ.succCtr}@${succ.succActor}`)
      checkSortedOpIds(op.succNum.map(succ => ({counter: succ.succCtr, actorId: succ.succActor})))
    } else {
      newOp.pred = op.predNum.map(pred => `${pred.predCtr}@${pred.predActor}`)
      checkSortedOpIds(op.predNum.map(pred => ({counter: pred.predCtr, actorId: pred.predActor})))
    }
    newOps.push(newOp)
  }
  return newOps
}

/**
 * Throws an exception if the opIds in the given array are not in sorted order.
 */
function checkSortedOpIds(opIds) {
  let last = null
  for (let opId of opIds) {
    if (last && compareParsedOpIds(last, opId) !== -1) {
      throw new RangeError('operation IDs are not in ascending order')
    }
    last = opId
  }
}

function encoderByColumnId(columnId) {
  if ((columnId & 7) === COLUMN_TYPE.INT_DELTA) {
    return new DeltaEncoder()
  } else if ((columnId & 7) === COLUMN_TYPE.BOOLEAN) {
    return new BooleanEncoder()
  } else if ((columnId & 7) === COLUMN_TYPE.STRING_RLE) {
    return new RLEEncoder('utf8')
  } else if ((columnId & 7) === COLUMN_TYPE.VALUE_RAW) {
    return new Encoder()
  } else {
    return new RLEEncoder('uint')
  }
}

function decoderByColumnId(columnId, buffer) {
  if ((columnId & 7) === COLUMN_TYPE.INT_DELTA) {
    return new DeltaDecoder(buffer)
  } else if ((columnId & 7) === COLUMN_TYPE.BOOLEAN) {
    return new BooleanDecoder(buffer)
  } else if ((columnId & 7) === COLUMN_TYPE.STRING_RLE) {
    return new RLEDecoder('utf8', buffer)
  } else if ((columnId & 7) === COLUMN_TYPE.VALUE_RAW) {
    return new Decoder(buffer)
  } else {
    return new RLEDecoder('uint', buffer)
  }
}

function makeDecoders(columns, columnSpec) {
  // By default, every column decodes an empty byte array
  const emptyBuf = new Uint8Array(0), decoders = {}
  for (let columnId of Object.values(columnSpec)) {
    decoders[columnId] = decoderByColumnId(columnId, emptyBuf)
  }
  for (let column of columns) {
    decoders[column.columnId] = decoderByColumnId(column.columnId, column.buffer)
  }

  let result = []
  for (let columnId of Object.keys(decoders).map(id => parseInt(id, 10)).sort((a, b) => a - b)) {
    let [columnName] = Object.entries(columnSpec).find(([/* name */, id]) => id === columnId)
    if (!columnName) columnName = columnId.toString()
    result.push({columnId, columnName, decoder: decoders[columnId]})
  }
  return result
}

function decodeColumns(columns, actorIds, columnSpec) {
  columns = makeDecoders(columns, columnSpec)
  let parsedRows = []
  while (columns.some(col => !col.decoder.done)) {
    let row = {}, col = 0
    while (col < columns.length) {
      const columnId = columns[col].columnId
      let groupId = columnId >> 4, groupCols = 1
      while (col + groupCols < columns.length && columns[col + groupCols].columnId >> 4 === groupId) {
        groupCols++
      }

      if (columnId % 8 === COLUMN_TYPE.GROUP_CARD) {
        const values = [], count = columns[col].decoder.readValue()
        for (let i = 0; i < count; i++) {
          let value = {}
          for (let colOffset = 1; colOffset < groupCols; colOffset++) {
            decodeValueColumns(columns, col + colOffset, actorIds, value)
          }
          values.push(value)
        }
        row[columns[col].columnName] = values
        col += groupCols
      } else {
        col += decodeValueColumns(columns, col, actorIds, row)
      }
    }
    parsedRows.push(row)
  }
  return parsedRows
}

function decodeColumnInfo(decoder) {
  // A number that is all 1 bits except for the bit that indicates whether a column is
  // deflate-compressed. We ignore this bit when checking whether columns are sorted by ID.
  const COLUMN_ID_MASK = (-1 ^ COLUMN_TYPE_DEFLATE) >>> 0

  let lastColumnId = -1, columns = [], numColumns = decoder.readUint53()
  for (let i = 0; i < numColumns; i++) {
    const columnId = decoder.readUint53(), bufferLen = decoder.readUint53()
    if ((columnId & COLUMN_ID_MASK) <= (lastColumnId & COLUMN_ID_MASK)) {
      throw new RangeError('Columns must be in ascending order')
    }
    lastColumnId = columnId
    columns.push({columnId, bufferLen})
  }
  return columns
}

function encodeColumnInfo(encoder, columns) {
  const nonEmptyColumns = columns.filter(column => column.encoder.buffer.byteLength > 0)
  encoder.appendUint53(nonEmptyColumns.length)
  for (let column of nonEmptyColumns) {
    encoder.appendUint53(column.id)
    encoder.appendUint53(column.encoder.buffer.byteLength)
  }
}

function decodeChangeHeader(decoder) {
  const numDeps = decoder.readUint53(), deps = []
  for (let i = 0; i < numDeps; i++) {
    deps.push(bytesToHexString(decoder.readRawBytes(32)))
  }
  let change = {
    actor:   decoder.readHexString(),
    seq:     decoder.readUint53(),
    startOp: decoder.readUint53(),
    time:    decoder.readInt53(),
    message: decoder.readPrefixedString(),
    deps
  }
  const actorIds = [change.actor], numActorIds = decoder.readUint53()
  for (let i = 0; i < numActorIds; i++) actorIds.push(decoder.readHexString())
  change.actorIds = actorIds
  return change
}

/**
 * Assembles a chunk of encoded data containing a checksum, headers, and a
 * series of encoded columns. Calls `encodeHeaderCallback` with an encoder that
 * should be used to add the headers. The columns should be given as `columns`.
 */
function encodeContainer(chunkType, encodeContentsCallback) {
  const CHECKSUM_SIZE = 4 // checksum is first 4 bytes of SHA-256 hash of the rest of the data
  const HEADER_SPACE = MAGIC_BYTES.byteLength + CHECKSUM_SIZE + 1 + 5 // 1 byte type + 5 bytes length
  const body = new Encoder()
  // Make space for the header at the beginning of the body buffer. We will
  // copy the header in here later. This is cheaper than copying the body since
  // the body is likely to be much larger than the header.
  body.appendRawBytes(new Uint8Array(HEADER_SPACE))
  encodeContentsCallback(body)

  const bodyBuf = body.buffer
  const header = new Encoder()
  header.appendByte(chunkType)
  header.appendUint53(bodyBuf.byteLength - HEADER_SPACE)

  // Compute the hash over chunkType, length, and body
  const headerBuf = header.buffer
  const sha256 = new Hash()
  sha256.update(headerBuf)
  sha256.update(bodyBuf.subarray(HEADER_SPACE))
  const hash = sha256.digest(), checksum = hash.subarray(0, CHECKSUM_SIZE)

  // Copy header into the body buffer so that they are contiguous
  bodyBuf.set(MAGIC_BYTES, HEADER_SPACE - headerBuf.byteLength - CHECKSUM_SIZE - MAGIC_BYTES.byteLength)
  bodyBuf.set(checksum,    HEADER_SPACE - headerBuf.byteLength - CHECKSUM_SIZE)
  bodyBuf.set(headerBuf,   HEADER_SPACE - headerBuf.byteLength)
  return {hash, bytes: bodyBuf.subarray(HEADER_SPACE - headerBuf.byteLength - CHECKSUM_SIZE - MAGIC_BYTES.byteLength)}
}

function decodeContainerHeader(decoder, computeHash) {
  if (!equalBytes(decoder.readRawBytes(MAGIC_BYTES.byteLength), MAGIC_BYTES)) {
    throw new RangeError('Data does not begin with magic bytes 85 6f 4a 83')
  }
  const expectedHash = decoder.readRawBytes(4)
  const hashStartOffset = decoder.offset
  const chunkType = decoder.readByte()
  const chunkLength = decoder.readUint53()
  const header = {chunkType, chunkLength, chunkData: decoder.readRawBytes(chunkLength)}

  if (computeHash) {
    const sha256 = new Hash()
    sha256.update(decoder.buf.subarray(hashStartOffset, decoder.offset))
    const binaryHash = sha256.digest()
    if (!equalBytes(binaryHash.subarray(0, 4), expectedHash)) {
      throw new RangeError('checksum does not match data')
    }
    header.hash = bytesToHexString(binaryHash)
  }
  return header
}

/**
 * Returns the checksum of a change (bytes 4 to 7) as a 32-bit unsigned integer.
 */
function getChangeChecksum(change) {
  if (change[0] !== MAGIC_BYTES[0] || change[1] !== MAGIC_BYTES[1] ||
      change[2] !== MAGIC_BYTES[2] || change[3] !== MAGIC_BYTES[3]) {
    throw new RangeError('Data does not begin with magic bytes 85 6f 4a 83')
  }
  return ((change[4] << 24) | (change[5] << 16) | (change[6] << 8) | change[7]) >>> 0
}

function encodeChange(changeObj) {
  const { changes, actorIds } = parseAllOpIds([changeObj], true)
  const change = changes[0]

  const { hash, bytes } = encodeContainer(CHUNK_TYPE_CHANGE, encoder => {
    if (!Array.isArray(change.deps)) throw new TypeError('deps is not an array')
    encoder.appendUint53(change.deps.length)
    for (let hash of change.deps.slice().sort()) {
      encoder.appendRawBytes(hexStringToBytes(hash))
    }
    encoder.appendHexString(change.actor)
    encoder.appendUint53(change.seq)
    encoder.appendUint53(change.startOp)
    encoder.appendInt53(change.time)
    encoder.appendPrefixedString(change.message || '')
    encoder.appendUint53(actorIds.length - 1)
    for (let actor of actorIds.slice(1)) encoder.appendHexString(actor)

    const columns = encodeOps(change.ops, false)
    encodeColumnInfo(encoder, columns)
    for (let column of columns) encoder.appendRawBytes(column.encoder.buffer)
    if (change.extraBytes) encoder.appendRawBytes(change.extraBytes)
  })

  const hexHash = bytesToHexString(hash)
  if (changeObj.hash && changeObj.hash !== hexHash) {
    throw new RangeError(`Change hash does not match encoding: ${changeObj.hash} != ${hexHash}`)
  }
  return (bytes.byteLength >= DEFLATE_MIN_SIZE) ? deflateChange(bytes) : bytes
}

function decodeChangeColumns(buffer) {
  const decoder = new Decoder(buffer)
  const header = decodeContainerHeader(decoder, true)
  const chunkDecoder = new Decoder(header.chunkData)
  if (!decoder.done) throw new RangeError('Encoded change has trailing data')
  if (header.chunkType !== CHUNK_TYPE_CHANGE) throw new RangeError(`Unexpected chunk type: ${header.chunkType}`)

  const change = decodeChangeHeader(chunkDecoder)
  const columns = decodeColumnInfo(chunkDecoder)
  for (let i = 0; i < columns.length; i++) {
    if ((columns[i].columnId & COLUMN_TYPE_DEFLATE) !== 0) {
      throw new RangeError('change must not contain deflated columns')
    }
    columns[i].buffer = chunkDecoder.readRawBytes(columns[i].bufferLen)
  }
  if (!chunkDecoder.done) {
    const restLen = chunkDecoder.buf.byteLength - chunkDecoder.offset
    change.extraBytes = chunkDecoder.readRawBytes(restLen)
  }

  change.columns = columns
  change.hash = header.hash
  return change
}

/**
 * Decodes one change in binary format into its JS object representation.
 */
function decodeChange(buffer) {
  if (buffer[8] === CHUNK_TYPE_DEFLATE) buffer = inflateChange(buffer)
  const change = decodeChangeColumns(buffer)
  change.ops = decodeOps(decodeColumns(change.columns, change.actorIds, CHANGE_COLUMNS), false)
  delete change.actorIds
  delete change.columns
  return change
}

/**
 * Decodes the header fields of a change in binary format, but does not decode
 * the operations. Saves work when we only need to inspect the headers. Only
 * computes the hash of the change if `computeHash` is true.
 */
function decodeChangeMeta(buffer, computeHash) {
  if (buffer[8] === CHUNK_TYPE_DEFLATE) buffer = inflateChange(buffer)
  const header = decodeContainerHeader(new Decoder(buffer), computeHash)
  if (header.chunkType !== CHUNK_TYPE_CHANGE) {
    throw new RangeError('Buffer chunk type is not a change')
  }
  const meta = decodeChangeHeader(new Decoder(header.chunkData))
  meta.change = buffer
  if (computeHash) meta.hash = header.hash
  return meta
}

/**
 * Compresses a binary change using DEFLATE.
 */
function deflateChange(buffer) {
  const header = decodeContainerHeader(new Decoder(buffer), false)
  if (header.chunkType !== CHUNK_TYPE_CHANGE) throw new RangeError(`Unexpected chunk type: ${header.chunkType}`)
  const compressed = pako.deflateRaw(header.chunkData)
  const encoder = new Encoder()
  encoder.appendRawBytes(buffer.subarray(0, 8)) // copy MAGIC_BYTES and checksum
  encoder.appendByte(CHUNK_TYPE_DEFLATE)
  encoder.appendUint53(compressed.byteLength)
  encoder.appendRawBytes(compressed)
  return encoder.buffer
}

/**
 * Decompresses a binary change that has been compressed with DEFLATE.
 */
function inflateChange(buffer) {
  const header = decodeContainerHeader(new Decoder(buffer), false)
  if (header.chunkType !== CHUNK_TYPE_DEFLATE) throw new RangeError(`Unexpected chunk type: ${header.chunkType}`)
  const decompressed = pako.inflateRaw(header.chunkData)
  const encoder = new Encoder()
  encoder.appendRawBytes(buffer.subarray(0, 8)) // copy MAGIC_BYTES and checksum
  encoder.appendByte(CHUNK_TYPE_CHANGE)
  encoder.appendUint53(decompressed.byteLength)
  encoder.appendRawBytes(decompressed)
  return encoder.buffer
}

/**
 * Takes an Uint8Array that may contain multiple concatenated changes, and
 * returns an array of subarrays, each subarray containing one change.
 */
function splitContainers(buffer) {
  let decoder = new Decoder(buffer), chunks = [], startOffset = 0
  while (!decoder.done) {
    decodeContainerHeader(decoder, false)
    chunks.push(buffer.subarray(startOffset, decoder.offset))
    startOffset = decoder.offset
  }
  return chunks
}

/**
 * Decodes a list of changes from the binary format into JS objects.
 * `binaryChanges` is an array of `Uint8Array` objects.
 */
function decodeChanges(binaryChanges) {
  let decoded = []
  for (let binaryChange of binaryChanges) {
    for (let chunk of splitContainers(binaryChange)) {
      if (chunk[8] === CHUNK_TYPE_DOCUMENT) {
        decoded = decoded.concat(decodeDocument(chunk))
      } else if (chunk[8] === CHUNK_TYPE_CHANGE || chunk[8] === CHUNK_TYPE_DEFLATE) {
        decoded.push(decodeChange(chunk))
      } else {
        // ignoring chunk of unknown type
      }
    }
  }
  return decoded
}

function sortOpIds(a, b) {
  if (a === b) return 0
  if (a === '_root') return -1
  if (b === '_root') return +1
  const a_ = parseOpId(a), b_ = parseOpId(b)
  if (a_.counter < b_.counter) return -1
  if (a_.counter > b_.counter) return +1
  if (a_.actorId < b_.actorId) return -1
  if (a_.actorId > b_.actorId) return +1
  return 0
}

function groupDocumentOps(changes) {
  let byObjectId = {}, byReference = {}, objectType = {}
  for (let change of changes) {
    for (let i = 0; i < change.ops.length; i++) {
      const op = change.ops[i], opId = `${op.id.counter}@${op.id.actorId}`
      const objectId = (op.obj === '_root') ? '_root' : `${op.obj.counter}@${op.obj.actorId}`
      if (op.action.startsWith('make')) {
        objectType[opId] = op.action
        if (op.action === 'makeList' || op.action === 'makeText') {
          byReference[opId] = {'_head': []}
        }
      }

      let key
      if (objectId === '_root' || objectType[objectId] === 'makeMap' || objectType[objectId] === 'makeTable') {
        key = op.key
      } else if (objectType[objectId] === 'makeList' || objectType[objectId] === 'makeText') {
        if (op.insert) {
          key = opId
          const ref = (op.elemId === '_head') ? '_head' : `${op.elemId.counter}@${op.elemId.actorId}`
          byReference[objectId][ref].push(opId)
          byReference[objectId][opId] = []
        } else {
          key = `${op.elemId.counter}@${op.elemId.actorId}`
        }
      } else {
        throw new RangeError(`Unknown object type for object ${objectId}`)
      }

      if (!byObjectId[objectId]) byObjectId[objectId] = {}
      if (!byObjectId[objectId][key]) byObjectId[objectId][key] = {}
      byObjectId[objectId][key][opId] = op
      op.succ = []

      for (let pred of op.pred) {
        const predId = `${pred.counter}@${pred.actorId}`
        if (!byObjectId[objectId][key][predId]) {
          throw new RangeError(`No predecessor operation ${predId}`)
        }
        byObjectId[objectId][key][predId].succ.push(op.id)
      }
    }
  }

  let ops = []
  for (let objectId of Object.keys(byObjectId).sort(sortOpIds)) {
    let keys = []
    if (objectType[objectId] === 'makeList' || objectType[objectId] === 'makeText') {
      let stack = ['_head']
      while (stack.length > 0) {
        const key = stack.pop()
        if (key !== '_head') keys.push(key)
        for (let opId of byReference[objectId][key].sort(sortOpIds)) stack.push(opId)
      }
    } else {
      // FIXME JavaScript sorts based on UTF-16 encoding. We should change this to use the UTF-8
      // encoding instead (the sort order will be different beyond the basic multilingual plane)
      keys = Object.keys(byObjectId[objectId]).sort()
    }

    for (let key of keys) {
      for (let opId of Object.keys(byObjectId[objectId][key]).sort(sortOpIds)) {
        const op = byObjectId[objectId][key][opId]
        if (op.action !== 'del') ops.push(op)
      }
    }
  }
  return ops
}

/**
 * Takes a set of operations `ops` loaded from an encoded document, and
 * reconstructs the changes that they originally came from.
 * Does not return anything, only mutates `changes`.
 */
function groupChangeOps(changes, ops) {
  let changesByActor = {} // map from actorId to array of changes by that actor
  for (let change of changes) {
    change.ops = []
    if (!changesByActor[change.actor]) changesByActor[change.actor] = []
    if (change.seq !== changesByActor[change.actor].length + 1) {
      throw new RangeError(`Expected seq = ${changesByActor[change.actor].length + 1}, got ${change.seq}`)
    }
    if (change.seq > 1 && changesByActor[change.actor][change.seq - 2].maxOp > change.maxOp) {
      throw new RangeError('maxOp must increase monotonically per actor')
    }
    changesByActor[change.actor].push(change)
  }

  let opsById = {}
  for (let op of ops) {
    if (op.action === 'del') throw new RangeError('document should not contain del operations')
    op.pred = opsById[op.id] ? opsById[op.id].pred : []
    opsById[op.id] = op
    for (let succ of op.succ) {
      if (!opsById[succ]) {
        if (op.elemId) {
          const elemId = op.insert ? op.id : op.elemId
          opsById[succ] = {id: succ, action: 'del', obj: op.obj, elemId, pred: []}
        } else {
          opsById[succ] = {id: succ, action: 'del', obj: op.obj, key: op.key, pred: []}
        }
      }
      opsById[succ].pred.push(op.id)
    }
    delete op.succ
  }
  for (let op of Object.values(opsById)) {
    if (op.action === 'del') ops.push(op)
  }

  for (let op of ops) {
    const { counter, actorId } = parseOpId(op.id)
    const actorChanges = changesByActor[actorId]
    // Binary search to find the change that should contain this operation
    let left = 0, right = actorChanges.length
    while (left < right) {
      const index = Math.floor((left + right) / 2)
      if (actorChanges[index].maxOp < counter) {
        left = index + 1
      } else {
        right = index
      }
    }
    if (left >= actorChanges.length) {
      throw new RangeError(`Operation ID ${op.id} outside of allowed range`)
    }
    actorChanges[left].ops.push(op)
  }

  for (let change of changes) {
    change.ops.sort((op1, op2) => sortOpIds(op1.id, op2.id))
    change.startOp = change.maxOp - change.ops.length + 1
    delete change.maxOp
    for (let i = 0; i < change.ops.length; i++) {
      const op = change.ops[i], expectedId = `${change.startOp + i}@${change.actor}`
      if (op.id !== expectedId) {
        throw new RangeError(`Expected opId ${expectedId}, got ${op.id}`)
      }
      delete op.id
    }
  }
}

function encodeDocumentChanges(changes) {
  const columns = { // see DOCUMENT_COLUMNS
    actor     : new RLEEncoder('uint'),
    seq       : new DeltaEncoder(),
    maxOp     : new DeltaEncoder(),
    time      : new DeltaEncoder(),
    message   : new RLEEncoder('utf8'),
    depsNum   : new RLEEncoder('uint'),
    depsIndex : new DeltaEncoder(),
    extraLen  : new RLEEncoder('uint'),
    extraRaw  : new Encoder()
  }
  let indexByHash = {} // map from change hash to its index in the changes array
  let heads = {} // change hashes that are not a dependency of any other change

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i]
    indexByHash[change.hash] = i
    heads[change.hash] = true

    columns.actor.appendValue(change.actorNum)
    columns.seq.appendValue(change.seq)
    columns.maxOp.appendValue(change.startOp + change.ops.length - 1)
    columns.time.appendValue(change.time)
    columns.message.appendValue(change.message)
    columns.depsNum.appendValue(change.deps.length)

    for (let dep of change.deps) {
      if (typeof indexByHash[dep] !== 'number') {
        throw new RangeError(`Unknown dependency hash: ${dep}`)
      }
      columns.depsIndex.appendValue(indexByHash[dep])
      if (heads[dep]) delete heads[dep]
    }

    if (change.extraBytes) {
      columns.extraLen.appendValue(change.extraBytes.byteLength << 4 | VALUE_TYPE.BYTES)
      columns.extraRaw.appendRawBytes(change.extraBytes)
    } else {
      columns.extraLen.appendValue(VALUE_TYPE.BYTES) // zero-length byte array
    }
  }

  let changesColumns = []
  for (let [name, id] of Object.entries(DOCUMENT_COLUMNS)) {
    changesColumns.push({id, name, encoder: columns[name]})
  }
  changesColumns.sort((a, b) => a.id - b.id)
  return { changesColumns, heads: Object.keys(heads).sort() }
}

function decodeDocumentChanges(changes, expectedHeads) {
  let heads = {} // change hashes that are not a dependency of any other change
  for (let i = 0; i < changes.length; i++) {
    let change = changes[i]
    change.deps = []
    for (let index of change.depsNum.map(d => d.depsIndex)) {
      if (!changes[index] || !changes[index].hash) {
        throw new RangeError(`No hash for index ${index} while processing index ${i}`)
      }
      const hash = changes[index].hash
      change.deps.push(hash)
      if (heads[hash]) delete heads[hash]
    }
    change.deps.sort()
    delete change.depsNum

    if (change.extraLen_datatype !== VALUE_TYPE.BYTES) {
      throw new RangeError(`Bad datatype for extra bytes: ${VALUE_TYPE.BYTES}`)
    }
    change.extraBytes = change.extraLen
    delete change.extraLen_datatype

    // Encoding and decoding again to compute the hash of the change
    changes[i] = decodeChange(encodeChange(change))
    heads[changes[i].hash] = true
  }

  const actualHeads = Object.keys(heads).sort()
  let headsEqual = (actualHeads.length === expectedHeads.length), i = 0
  while (headsEqual && i < actualHeads.length) {
    headsEqual = (actualHeads[i] === expectedHeads[i])
    i++
  }
  if (!headsEqual) {
    throw new RangeError(`Mismatched heads hashes: expected ${expectedHeads.join(', ')}, got ${actualHeads.join(', ')}`)
  }
}

/**
 * Transforms a list of changes into a binary representation of the document state.
 */
function encodeDocument(binaryChanges) {
  const { changes, actorIds } = parseAllOpIds(decodeChanges(binaryChanges), false)
  const { changesColumns, heads } = encodeDocumentChanges(changes)
  const opsColumns = encodeOps(groupDocumentOps(changes), true)
  for (let column of changesColumns) deflateColumn(column)
  for (let column of opsColumns) deflateColumn(column)

  return encodeContainer(CHUNK_TYPE_DOCUMENT, encoder => {
    encoder.appendUint53(actorIds.length)
    for (let actor of actorIds) {
      encoder.appendHexString(actor)
    }
    encoder.appendUint53(heads.length)
    for (let head of heads.sort()) {
      encoder.appendRawBytes(hexStringToBytes(head))
    }
    encodeColumnInfo(encoder, changesColumns)
    encodeColumnInfo(encoder, opsColumns)
    for (let column of changesColumns) encoder.appendRawBytes(column.encoder.buffer)
    for (let column of opsColumns) encoder.appendRawBytes(column.encoder.buffer)
  }).bytes
}

function decodeDocumentHeader(buffer) {
  const documentDecoder = new Decoder(buffer)
  const header = decodeContainerHeader(documentDecoder, true)
  const decoder = new Decoder(header.chunkData)
  if (!documentDecoder.done) throw new RangeError('Encoded document has trailing data')
  if (header.chunkType !== CHUNK_TYPE_DOCUMENT) throw new RangeError(`Unexpected chunk type: ${header.chunkType}`)

  const actorIds = [], numActors = decoder.readUint53()
  for (let i = 0; i < numActors; i++) {
    actorIds.push(decoder.readHexString())
  }
  const heads = [], numHeads = decoder.readUint53()
  for (let i = 0; i < numHeads; i++) {
    heads.push(bytesToHexString(decoder.readRawBytes(32)))
  }

  const changesColumns = decodeColumnInfo(decoder)
  const opsColumns = decodeColumnInfo(decoder)
  for (let i = 0; i < changesColumns.length; i++) {
    changesColumns[i].buffer = decoder.readRawBytes(changesColumns[i].bufferLen)
    inflateColumn(changesColumns[i])
  }
  for (let i = 0; i < opsColumns.length; i++) {
    opsColumns[i].buffer = decoder.readRawBytes(opsColumns[i].bufferLen)
    inflateColumn(opsColumns[i])
  }

  const extraBytes = decoder.readRawBytes(decoder.buf.byteLength - decoder.offset)
  return { changesColumns, opsColumns, actorIds, heads, extraBytes }
}

function decodeDocument(buffer) {
  const { changesColumns, opsColumns, actorIds, heads } = decodeDocumentHeader(buffer)
  const changes = decodeColumns(changesColumns, actorIds, DOCUMENT_COLUMNS)
  const ops = decodeOps(decodeColumns(opsColumns, actorIds, DOC_OPS_COLUMNS), true)
  groupChangeOps(changes, ops)
  decodeDocumentChanges(changes, heads)
  return changes
}

/**
 * DEFLATE-compresses the given column if it is large enough to make the compression worthwhile.
 */
function deflateColumn(column) {
  if (column.encoder.buffer.byteLength >= DEFLATE_MIN_SIZE) {
    column.encoder = {buffer: pako.deflateRaw(column.encoder.buffer)}
    column.id |= COLUMN_TYPE_DEFLATE
  }
}

/**
 * Decompresses the given column if it is DEFLATE-compressed.
 */
function inflateColumn(column) {
  if ((column.columnId & COLUMN_TYPE_DEFLATE) !== 0) {
    column.buffer = pako.inflateRaw(column.buffer)
    column.columnId ^= COLUMN_TYPE_DEFLATE
  }
}

/**
 * Takes all the operations for the same property (i.e. the same key in a map, or the same list
 * element) and mutates the object patch to reflect the current value(s) of that property. There
 * might be multiple values in the case of a conflict. `objects` is a map from objectId to the
 * patch for that object. `property` contains `objId`, `key`, a list of `ops`, and `index` (the
 * current list index if the object is a list). Returns true if one or more values are present,
 * or false if the property has been deleted.
 */
function addPatchProperty(objects, property) {
  let values = {}, counter = null
  for (let op of property.ops) {
    // Apply counters and their increments regardless of the number of successor operations
    if (op.actionName === 'set' && op.value.datatype === 'counter') {
      if (!counter) counter = {opId: op.opId, value: 0, succ: {}}
      counter.value += op.value.value
      for (let succId of op.succ) counter.succ[succId] = true
    } else if (op.actionName === 'inc') {
      if (!counter) throw new RangeError(`inc operation ${op.opId} without a counter`)
      counter.value += op.value.value
      delete counter.succ[op.opId]
      for (let succId of op.succ) counter.succ[succId] = true

    } else if (op.succ.length === 0) { // Ignore any ops that have been overwritten
      if (op.actionName.startsWith('make')) {
        values[op.opId] = objects[op.opId]
      } else if (op.actionName === 'set') {
        values[op.opId] = {value: op.value.value, type: 'value'}
        if (op.value.datatype) {
          values[op.opId].datatype = op.value.datatype
        }
      } else if (op.actionName === 'link') {
        // NB. This assumes that the ID of the child object is greater than the ID of the current
        // object. This is true as long as link operations are only used to redo undone make*
        // operations, but it will cease to be true once subtree moves are allowed.
        if (!op.childId) throw new RangeError(`link operation ${op.opId} without a childId`)
        values[op.opId] = objects[op.childId]
      } else {
        throw new RangeError(`Unexpected action type: ${op.actionName}`)
      }
    }
  }

  // If the counter had any successor operation that was not an increment, that means the counter
  // must have been deleted, so we omit it from the patch.
  if (counter && Object.keys(counter.succ).length === 0) {
    values[counter.opId] = {type: 'value', value: counter.value, datatype: 'counter'}
  }

  if (Object.keys(values).length > 0) {
    let obj = objects[property.objId]
    if (obj.type === 'map' || obj.type === 'table') {
      obj.props[property.key] = values
    } else if (obj.type === 'list' || obj.type === 'text') {
      makeListEdits(obj, values, property.key, property.index)
    }
    return true
  } else {
    return false
  }
}

/**
 * When constructing a patch to instantiate a loaded document, this function adds the edits to
 * insert one list element. Usually there is one value, but in the case of a conflict there may be
 * several values. `elemId` is the ID of the list element, and `index` is the list index at which
 * the value(s) should be placed.
 */
function makeListEdits(list, values, elemId, index) {
  let firstValue = true
  const opIds = Object.keys(values).sort((id1, id2) => compareParsedOpIds(parseOpId(id1), parseOpId(id2)))
  for (const opId of opIds) {
    if (firstValue) {
      list.edits.push({action: 'insert', value: values[opId], elemId, opId, index})
    } else {
      list.edits.push({action: 'update', value: values[opId], opId, index})
    }
    firstValue = false
  }
}

/**
 * Recursively walks the patch tree, calling appendEdit on every list edit in order to consense
 * consecutive sequences of insertions into multi-inserts.
 */
function condenseEdits(diff) {
  if (diff.type === 'list' || diff.type === 'text') {
    diff.edits.forEach(e => condenseEdits(e.value))
    let newEdits = diff.edits
    diff.edits = []
    for (const edit of newEdits) appendEdit(diff.edits, edit)
  } else if (diff.type === 'map' || diff.type === 'table') {
    for (const prop of Object.keys(diff.props)) {
      for (const opId of Object.keys(diff.props[prop])) {
        condenseEdits(diff.props[prop][opId])
      }
    }
  }
}

/**
 * Appends a list edit operation (insert, update, remove) to an array of existing operations. If the
 * last existing operation can be extended (as a multi-op), we do that.
 */
function appendEdit(existingEdits, nextEdit) {
  if (existingEdits.length === 0) {
    existingEdits.push(nextEdit)
    return
  }

  let lastEdit = existingEdits[existingEdits.length - 1]
  if (lastEdit.action === 'insert' && nextEdit.action === 'insert' &&
      lastEdit.index === nextEdit.index - 1 &&
      lastEdit.value.type === 'value' && nextEdit.value.type === 'value' &&
      lastEdit.elemId === lastEdit.opId && nextEdit.elemId === nextEdit.opId &&
      opIdDelta(lastEdit.elemId, nextEdit.elemId, 1) &&
      lastEdit.value.datatype === nextEdit.value.datatype &&
      typeof lastEdit.value.value === typeof nextEdit.value.value) {
    lastEdit.action = 'multi-insert'
    if (nextEdit.value.datatype) { lastEdit.datatype = nextEdit.value.datatype }
    lastEdit.values = [lastEdit.value.value, nextEdit.value.value]
    delete lastEdit.value
    delete lastEdit.opId

  } else if (lastEdit.action === 'multi-insert' && nextEdit.action === 'insert' &&
             lastEdit.index + lastEdit.values.length === nextEdit.index &&
             nextEdit.value.type === 'value' && nextEdit.elemId === nextEdit.opId &&
             opIdDelta(lastEdit.elemId, nextEdit.elemId, lastEdit.values.length) &&
             lastEdit.datatype === nextEdit.value.datatype &&
             typeof lastEdit.values[0] === typeof nextEdit.value.value) {
    lastEdit.values.push(nextEdit.value.value)

  } else if (lastEdit.action === 'remove' && nextEdit.action === 'remove' &&
             lastEdit.index === nextEdit.index) {
    lastEdit.count += nextEdit.count

  } else {
    existingEdits.push(nextEdit)
  }
}

/**
 * Returns true if the two given operation IDs have the same actor ID, and the counter of `id2` is
 * exactly `delta` greater than the counter of `id1`.
 */
function opIdDelta(id1, id2, delta = 1) {
  const parsed1 = parseOpId(id1), parsed2 = parseOpId(id2)
  return parsed1.actorId === parsed2.actorId && parsed1.counter + delta === parsed2.counter
}

/**
 * Parses the document (in compressed binary format) given as `documentBuffer`
 * and returns a patch that can be sent to the frontend to instantiate the
 * current state of that document.
 */
function constructPatch(documentBuffer) {
  const { opsColumns, actorIds } = decodeDocumentHeader(documentBuffer)
  const col = makeDecoders(opsColumns, DOC_OPS_COLUMNS).reduce(
    (acc, col) => Object.assign(acc, {[col.columnName]: col.decoder}), {})

  let objects = {_root: {objectId: '_root', type: 'map', props: {}}}
  let property = null

  while (!col.idActor.done) {
    const opId = `${col.idCtr.readValue()}@${actorIds[col.idActor.readValue()]}`
    const action = col.action.readValue(), actionName = ACTIONS[action]
    if (action % 2 === 0) { // even-numbered actions are object creation
      const type = OBJECT_TYPE[actionName] || 'unknown'
      if (type === 'list' || type === 'text') {
        objects[opId] = {objectId: opId, type, edits: []}
      } else {
        objects[opId] = {objectId: opId, type, props: {}}
      }
    }

    const objActor = col.objActor.readValue(), objCtr = col.objCtr.readValue()
    const objId = objActor === null ? '_root' : `${objCtr}@${actorIds[objActor]}`
    let obj = objects[objId]
    if (!obj) throw new RangeError(`Operation for nonexistent object: ${objId}`)

    const keyActor = col.keyActor.readValue(), keyCtr = col.keyCtr.readValue()
    const keyStr = col.keyStr.readValue(), insert = !!col.insert.readValue()
    const chldActor = col.chldActor.readValue(), chldCtr = col.chldCtr.readValue()
    const childId = chldActor === null ? null : `${chldCtr}@${actorIds[chldActor]}`
    const sizeTag = col.valLen.readValue()
    const rawValue = col.valRaw.readRawBytes(sizeTag >> 4)
    const value = decodeValue(sizeTag, rawValue)
    const succNum = col.succNum.readValue()
    let succ = []
    for (let i = 0; i < succNum; i++) {
      succ.push(`${col.succCtr.readValue()}@${actorIds[col.succActor.readValue()]}`)
    }

    if (!actionName || obj.type === 'unknown') continue

    let key
    if (obj.type === 'list' || obj.type === 'text') {
      if (keyCtr === null || (keyCtr === 0 && !insert)) {
        throw new RangeError(`Operation ${opId} on ${obj.type} object has no key`)
      }
      key = insert ? opId : `${keyCtr}@${actorIds[keyActor]}`
    } else {
      if (keyStr === null) {
        throw new RangeError(`Operation ${opId} on ${obj.type} object has no key`)
      }
      key = keyStr
    }

    if (!property || property.objId !== objId || property.key !== key) {
      let index = 0
      if (property) {
        index = property.index
        if (addPatchProperty(objects, property)) index += 1
        if (property.objId !== objId) index = 0
      }
      property = {objId, key, index, ops: []}
    }
    property.ops.push({opId, actionName, value, childId, succ})
  }

  if (property) addPatchProperty(objects, property)
  condenseEdits(objects._root)
  return objects._root
}

/**
 * Scans a chunk of document operations, encoded as columns `docCols`, to find the position at which
 * an operation (or sequence of operations) `ops` should be applied. Returns an object with keys:
 *   - `skipCount`: the number of operations, counted from the start of the chunk, after which the
 *     new operations should be inserted or applied.
 *   - `visibleCount`: if modifying a list object, the number of visible (i.e. non-deleted) list
 *     elements that precede the position where the new operations should be applied.
 */
function seekToOp(ops, docCols, actorIds) {
  const { objActor, objCtr, keyActor, keyCtr, keyStr, idActor, idCtr, insert } = ops
  const [objActorD, objCtrD, /* keyActorD */, /* keyCtrD */, keyStrD, idActorD, idCtrD, insertD, actionD,
    /* valLenD */, /* valRawD */, /* chldActorD */, /* chldCtrD */, succNumD] = docCols.map(col => col.decoder)
  let skipCount = 0, visibleCount = 0, elemVisible = false, nextObjActor = null, nextObjCtr = null
  let nextIdActor = null, nextIdCtr = null, nextKeyStr = null, nextInsert = null, nextSuccNum = 0

  // Seek to the beginning of the object being updated
  if (objCtr !== null) {
    while (!objCtrD.done || !objActorD.done || !actionD.done) {
      nextObjCtr = objCtrD.readValue()
      nextObjActor = actorIds[objActorD.readValue()]
      actionD.skipValues(1)
      if (nextObjCtr === null || !nextObjActor || nextObjCtr < objCtr ||
          (nextObjCtr === objCtr && nextObjActor < objActor)) {
        skipCount += 1
      } else {
        break
      }
    }
  }
  if (nextObjCtr !== objCtr || nextObjActor !== objActor) return {skipCount, visibleCount}

  // Seek to the appropriate key (if string key is used)
  if (keyStr !== null) {
    keyStrD.skipValues(skipCount)
    while (!keyStrD.done) {
      const objActorIndex = objActorD.readValue()
      nextObjActor = objActorIndex === null ? null : actorIds[objActorIndex]
      nextObjCtr = objCtrD.readValue()
      nextKeyStr = keyStrD.readValue()
      if (nextKeyStr !== null && nextKeyStr < keyStr &&
          nextObjCtr === objCtr && nextObjActor === objActor) {
        skipCount += 1
      } else {
        break
      }
    }
    return {skipCount, visibleCount}
  }

  idCtrD.skipValues(skipCount)
  idActorD.skipValues(skipCount)
  insertD.skipValues(skipCount)
  succNumD.skipValues(skipCount)
  nextIdCtr = idCtrD.readValue()
  nextIdActor = actorIds[idActorD.readValue()]
  nextInsert = insertD.readValue()
  nextSuccNum = succNumD.readValue()

  // If we are inserting into a list, an opId key is used, and we need to seek to a position *after*
  // the referenced operation. Moreover, we need to skip over any existing operations with a greater
  // opId than the new insertion, for CRDT convergence on concurrent insertions in the same place.
  if (insert) {
    // If insertion is not at the head, search for the reference element
    if (keyCtr !== null && keyCtr > 0 && keyActor !== null) {
      skipCount += 1
      while (!idCtrD.done && !idActorD.done && (nextIdCtr !== keyCtr || nextIdActor !== keyActor)) {
        if (nextInsert) elemVisible = false
        if (nextSuccNum === 0 && !elemVisible) {
          visibleCount += 1
          elemVisible = true
        }
        nextIdCtr = idCtrD.readValue()
        nextIdActor = actorIds[idActorD.readValue()]
        nextObjCtr = objCtrD.readValue()
        nextObjActor = actorIds[objActorD.readValue()]
        nextInsert = insertD.readValue()
        nextSuccNum = succNumD.readValue()
        if (nextObjCtr === objCtr && nextObjActor === objActor) skipCount += 1; else break
      }
      if (nextObjCtr !== objCtr || nextObjActor !== objActor || nextIdCtr !== keyCtr ||
          nextIdActor !== keyActor || !nextInsert) {
        throw new RangeError(`Reference element not found: ${keyCtr}@${keyActor}`)
      }
      if (nextInsert) elemVisible = false
      if (nextSuccNum === 0 && !elemVisible) {
        visibleCount += 1
        elemVisible = true
      }

      // Set up the next* variables to the operation following the reference element
      if (idCtrD.done || idActorD.done) return {skipCount, visibleCount}
      nextIdCtr = idCtrD.readValue()
      nextIdActor = actorIds[idActorD.readValue()]
      nextObjCtr = objCtrD.readValue()
      nextObjActor = actorIds[objActorD.readValue()]
      nextInsert = insertD.readValue()
      nextSuccNum = succNumD.readValue()
    }

    // Skip over any list elements with greater ID than the new one, and any non-insertions
    while ((!nextInsert || nextIdCtr > idCtr || (nextIdCtr === idCtr && nextIdActor > idActor)) &&
           nextObjCtr === objCtr && nextObjActor === objActor) {
      skipCount += 1
      if (nextInsert) elemVisible = false
      if (nextSuccNum === 0 && !elemVisible) {
        visibleCount += 1
        elemVisible = true
      }
      if (!idCtrD.done && !idActorD.done) {
        nextIdCtr = idCtrD.readValue()
        nextIdActor = actorIds[idActorD.readValue()]
        nextObjCtr = objCtrD.readValue()
        nextObjActor = actorIds[objActorD.readValue()]
        nextInsert = insertD.readValue()
        nextSuccNum = succNumD.readValue()
      } else {
        break
      }
    }

  } else if (keyCtr !== null && keyCtr > 0 && keyActor !== null) {
    // If we are updating an existing list element, seek to just before the referenced ID
    while ((!nextInsert || nextIdCtr !== keyCtr || nextIdActor !== keyActor) &&
           nextObjCtr === objCtr && nextObjActor === objActor) {
      skipCount += 1
      if (nextInsert) elemVisible = false
      if (nextSuccNum === 0 && !elemVisible) {
        visibleCount += 1
        elemVisible = true
      }
      if (!idCtrD.done && !idActorD.done) {
        nextIdCtr = idCtrD.readValue()
        nextIdActor = actorIds[idActorD.readValue()]
        nextObjCtr = objCtrD.readValue()
        nextObjActor = actorIds[objActorD.readValue()]
        nextInsert = insertD.readValue()
        nextSuccNum = succNumD.readValue()
      } else {
        break
      }
    }
    if (nextObjCtr !== objCtr || nextObjActor !== objActor || nextIdCtr !== keyCtr ||
        nextIdActor !== keyActor || !nextInsert) {
      throw new RangeError(`Element not found for update: ${keyCtr}@${keyActor}`)
    }
  }
  return {skipCount, visibleCount}
}

/**
 * Copies `count` rows from the set of input columns `inCols` to the set of output columns
 * `outCols`. The input columns are given as an array of `{columnId, decoder}` objects, and the
 * output columns are given as an array of `{columnId, encoder}` objects. Both are sorted in
 * increasing order of columnId. If there is no matching input column for a given output column, it
 * is filled in with `count` blank values (according to the column type).
 */
function copyColumns(outCols, inCols, count) {
  if (count === 0) return
  let inIndex = 0, lastGroup = -1, lastCardinality = 0, valueColumn = -1, valueBytes = 0
  for (let outCol of outCols) {
    while (inIndex < inCols.length && inCols[inIndex].columnId < outCol.columnId) inIndex++
    let inCol = null
    if (inIndex < inCols.length && inCols[inIndex].columnId === outCol.columnId &&
        inCols[inIndex].decoder.buf.byteLength > 0) {
      inCol = inCols[inIndex].decoder
    }
    const colCount = (outCol.columnId >> 4 === lastGroup) ? lastCardinality : count

    if (outCol.columnId % 8 === COLUMN_TYPE.GROUP_CARD) {
      lastGroup = outCol.columnId >> 4
      if (inCol) {
        lastCardinality = outCol.encoder.copyFrom(inCol, {count, sumValues: true}).sum
      } else {
        outCol.encoder.appendValue(0, count)
        lastCardinality = 0
      }
    } else if (outCol.columnId % 8 === COLUMN_TYPE.VALUE_LEN) {
      if (inCol) {
        if (inIndex + 1 === inCols.length || inCols[inIndex + 1].columnId !== outCol.columnId + 1) {
          throw new RangeError('VALUE_LEN column without accompanying VALUE_RAW column')
        }
        valueColumn = outCol.columnId + 1
        valueBytes = outCol.encoder.copyFrom(inCol, {count: colCount, sumValues: true, sumShift: 4}).sum
      } else {
        outCol.encoder.appendValue(null, colCount)
        valueColumn = outCol.columnId + 1
        valueBytes = 0
      }
    } else if (outCol.columnId % 8 === COLUMN_TYPE.VALUE_RAW) {
      if (outCol.columnId !== valueColumn) {
        throw new RangeError('VALUE_RAW column without accompanying VALUE_LEN column')
      }
      if (valueBytes > 0) {
        outCol.encoder.appendRawBytes(inCol.readRawBytes(valueBytes))
      }
    } else { // ACTOR_ID, INT_RLE, INT_DELTA, BOOLEAN, or STRING_RLE
      if (inCol) {
        outCol.encoder.copyFrom(inCol, {count: colCount})
      } else {
        const blankValue = (outCol.columnId % 8 === COLUMN_TYPE.BOOLEAN) ? false : null
        outCol.encoder.appendValue(blankValue, colCount)
      }
    }
  }
}

/**
 * Parses one operation from a set of columns. The argument `columns` contains a list of objects
 * with `columnId` and `decoder` properties. Returns an array in which the i'th element is the
 * value read from the i'th column in `columns`. Does not interpret datatypes; the only
 * interpretation of values is that if `actorTable` is given, a value `v` in a column of type
 * ACTOR_ID is replaced with `actorTable[v]`.
 */
function readOperation(columns, actorTable) {
  let operation = [], colValue, lastGroup = -1, lastCardinality = 0, valueColumn = -1, valueBytes = 0
  for (let col of columns) {
    if (col.columnId % 8 === COLUMN_TYPE.VALUE_RAW) {
      if (col.columnId !== valueColumn) throw new RangeError('unexpected VALUE_RAW column')
      colValue = col.decoder.readRawBytes(valueBytes)
    } else if (col.columnId % 8 === COLUMN_TYPE.GROUP_CARD) {
      lastGroup = col.columnId >> 4
      lastCardinality = col.decoder.readValue() || 0
      colValue = lastCardinality
    } else if (col.columnId >> 4 === lastGroup) {
      colValue = []
      if (col.columnId % 8 === COLUMN_TYPE.VALUE_LEN) {
        valueColumn = col.columnId + 1
        valueBytes = 0
      }
      for (let i = 0; i < lastCardinality; i++) {
        let value = col.decoder.readValue()
        if (col.columnId % 8 === COLUMN_TYPE.ACTOR_ID && actorTable && typeof value === 'number') {
          value = actorTable[value]
        }
        if (col.columnId % 8 === COLUMN_TYPE.VALUE_LEN) {
          valueBytes += colValue >>> 4
        }
        colValue.push(value)
      }
    } else {
      colValue = col.decoder.readValue()
      if (col.columnId % 8 === COLUMN_TYPE.ACTOR_ID && actorTable && typeof colValue === 'number') {
        colValue = actorTable[colValue]
      }
      if (col.columnId % 8 === COLUMN_TYPE.VALUE_LEN) {
        valueColumn = col.columnId + 1
        valueBytes = colValue >>> 4
      }
    }

    operation.push(colValue)
  }
  return operation
}

/**
 * Appends `operation`, in the form returned by `readOperation()`, to the columns in `outCols`. The
 * argument `inCols` provides metadata about the types of columns in `operation`; the value
 * `operation[i]` comes from the column `inCols[i]`.
 */
function appendOperation(outCols, inCols, operation) {
  let inIndex = 0, lastGroup = -1, lastCardinality = 0
  for (let outCol of outCols) {
    while (inIndex < inCols.length && inCols[inIndex].columnId < outCol.columnId) inIndex++

    if (inIndex < inCols.length && inCols[inIndex].columnId === outCol.columnId) {
      const colValue = operation[inIndex]
      if (outCol.columnId % 8 === COLUMN_TYPE.GROUP_CARD) {
        lastGroup = outCol.columnId >> 4
        lastCardinality = colValue
        outCol.encoder.appendValue(colValue)
      } else if (outCol.columnId >> 4 === lastGroup) {
        if (!Array.isArray(colValue) || colValue.length !== lastCardinality) {
          throw new RangeError('bad group value')
        }
        for (let v of colValue) outCol.encoder.appendValue(v)
      } else if (outCol.columnId % 8 === COLUMN_TYPE.VALUE_RAW) {
        outCol.encoder.appendRawBytes(colValue)
      } else {
        outCol.encoder.appendValue(colValue)
      }
    } else if (outCol.columnId % 8 === COLUMN_TYPE.GROUP_CARD) {
      lastGroup = outCol.columnId >> 4
      lastCardinality = 0
      outCol.encoder.appendValue(0)
    } else if (outCol.columnId % 8 !== COLUMN_TYPE.VALUE_RAW) {
      const count = (outCol.columnId >> 4 === lastGroup) ? lastCardinality : 1
      let blankValue = null
      if (outCol.columnId % 8 === COLUMN_TYPE.BOOLEAN) blankValue = false
      if (outCol.columnId % 8 === COLUMN_TYPE.VALUE_LEN) blankValue = 0
      outCol.encoder.appendValue(blankValue, count)
    }
  }
}

/**
 * Given a change parsed by `decodeChangeColumns()` and its column decoders as instantiated by
 * `makeDecoders()`, reads the operations in the change and groups together any related operations
 * that can be applied at the same time. Returns an object of the form `{opSequences, objectIds}`:
 *    - `opSequences` is an array of operation groups, where each group is an object with a
 *      `consecutiveOps` property indicating how many operations are in that group.
 *    - `objectIds` is an array of objectIds that are created or modified in this change.
 *
 * In order for a set of operations to be related, they have to satisfy the following properties:
 *   1. They must all be for the same object. (Even when several objects are created in the same
 *      change, we don't group together operations from different objects, since those ops may not
 *      be consecutive in the document, since objectIds from different actors can be interleaved.)
 *   2. Operations with string keys must appear in lexicographic order. For operations with opId
 *      keys (i.e. list/text operations), this function does not know whether the order of
 *      operations in the change matches the document order. We optimistically group together any
 *      such operations for the same object, on the basis that the ops are likely to be consecutive
 *      in practice (e.g. deleting a consecutive sequence of characters from text is likely to be
 *      represented by a sequence of deletion operations in document order).
 *   3. On a list, the operations must either all be non-insertions (i.e. updates/deletions of
 *      existing list items), or they must be consecutive insertions (where each operation inserts
 *      immediately after the preceding operations). Non-consecutive insertions are returned as
 *      separate groups.
 *
 * The `objectMeta` argument is a map from objectId to metadata about that object (such as the
 * object type, that object's parent, and the key within the parent object where it is located).
 * This function mutates `objectMeta` to include objects created in this change.
 */
function groupRelatedOps(change, changeCols, objectMeta) {
  const currentActor = change.actorIds[0]
  const [objActorD, objCtrD, keyActorD, keyCtrD, keyStrD, /* idActorD */, /* idCtrD */, insertD, actionD] =
    changeCols.map(col => col.decoder)
  let objIdSeen = {}, firstOp = null, lastOp = null, opIdCtr = change.startOp
  let opSequences = [], objectIds = {}

  while (!actionD.done) {
    const objActor = objActorD.readValue(), keyActor = keyActorD.readValue()
    const thisOp = {
      objActor : objActor === null ? null : change.actorIds[objActor],
      objCtr   : objCtrD.readValue(),
      keyActor : keyActor === null ? null : change.actorIds[keyActor],
      keyCtr   : keyCtrD.readValue(),
      keyStr   : keyStrD.readValue(),
      idActor  : currentActor,
      idCtr    : opIdCtr,
      insert   : insertD.readValue(),
      action   : actionD.readValue(),
      idActorIndex  : -1, // the index of currentActor in the document's actor list, filled in later
      consecutiveOps: 1
    }
    if ((thisOp.objCtr === null && thisOp.objActor !== null) ||
        (thisOp.objCtr !== null && typeof thisOp.objActor !== 'string')) {
      throw new RangeError(`Mismatched object reference: (${thisOp.objCtr}, ${thisOp.objActor})`)
    }
    if ((thisOp.keyCtr === null && thisOp.keyActor !== null) ||
        (thisOp.keyCtr === 0    && thisOp.keyActor !== null) ||
        (thisOp.keyCtr >   0    && typeof thisOp.keyActor !== 'string')) {
      throw new RangeError(`Mismatched operation key: (${thisOp.keyCtr}, ${thisOp.keyActor})`)
    }

    thisOp.opId = `${thisOp.idCtr}@${thisOp.idActor}`
    thisOp.objId = thisOp.objCtr === null ? '_root' : `${thisOp.objCtr}@${thisOp.objActor}`
    objectIds[thisOp.objId] = true

    // An even-numbered action indicates a make* operation that creates a new object.
    // TODO: also handle link/move operations.
    if (thisOp.action % 2 === 0) {
      let parentKey
      if (thisOp.keyStr !== null) {
        parentKey = thisOp.keyStr
      } else if (thisOp.insert) {
        parentKey = thisOp.opId
      } else {
        parentKey = `${thisOp.keyCtr}@${thisOp.keyActor}`
      }
      const type = thisOp.action < ACTIONS.length ? OBJECT_TYPE[ACTIONS[thisOp.action]] : null
      objectMeta[thisOp.opId] = {parentObj: thisOp.objId, parentKey, opId: thisOp.opId, type, children: {}}
      objectIds[thisOp.opId] = true
      deepCopyUpdate(objectMeta, [thisOp.objId, 'children', parentKey, thisOp.opId],
                     {objectId: thisOp.opId, type, props: {}})
    }

    if (!firstOp) {
      firstOp = thisOp
      lastOp = thisOp
    } else if (thisOp.objActor === lastOp.objActor && thisOp.objCtr === lastOp.objCtr && (
        (thisOp.keyStr !== null && lastOp.keyStr !== null && lastOp.keyStr <= thisOp.keyStr) ||
        (thisOp.keyStr === null && lastOp.keyStr === null && !lastOp.insert && !thisOp.insert) ||
        (thisOp.keyStr === null && lastOp.keyStr === null && lastOp.insert && thisOp.insert &&
         thisOp.keyActor === lastOp.idActor && thisOp.keyCtr === lastOp.idCtr))) {
      firstOp.consecutiveOps += 1
      lastOp = thisOp
    } else {
      objIdSeen[thisOp.objId] = true
      opSequences.push(firstOp)
      firstOp = thisOp
      lastOp = thisOp
    }

    opIdCtr += 1
  }

  if (firstOp) opSequences.push(firstOp)
  return {opSequences, objectIds: Object.keys(objectIds)}
}

class BackendDoc {
  constructor(buffer) {
    this.maxOp = 0
    this.changes = []
    this.changeByHash = {}
    this.hashesByActor = {}
    this.actorIds = []
    this.heads = []
    this.clock = {}

    if (buffer) {
      const doc = decodeDocumentHeader(buffer)
      for (let change of decodeChanges([buffer])) {
        const binaryChange = encodeChange(change) // decoding and re-encoding, argh!
        this.changes.push(binaryChange)
        this.changeByHash[change.hash] = binaryChange
        this.clock[change.actor] = Math.max(change.seq, this.clock[change.actor] || 0)
      }
      this.actorIds = doc.actorIds
      this.heads = doc.heads
      this.docColumns = makeDecoders(doc.opsColumns, DOC_OPS_COLUMNS)
      this.numOps = 0 // TODO count actual number of ops in the document
      this.objectMeta = {} // TODO fill this in
    } else {
      this.docColumns = makeDecoders([], DOC_OPS_COLUMNS)
      this.numOps = 0
      this.objectMeta = {_root: {parentObj: null, parentKey: null, opId: null, type: 'map', children: {}}}
    }
  }

  /**
   * Makes a copy of this BackendDoc that can be independently modified.
   */
  clone() {
    // It's sufficient to just copy the object's member variables because we don't mutate the
    // contents of those variables (so no deep cloning is needed)
    let copy = new BackendDoc()
    copy.maxOp = this.maxOp
    copy.changes = this.changes
    copy.changeByHash = this.changeByHash
    copy.actorIds = this.actorIds
    copy.heads = this.heads
    copy.clock = this.clock
    copy.docColumns = this.docColumns
    copy.numOps = this.numOps
    copy.objectMeta = this.objectMeta
    return copy
  }

  /**
   * Updates `patches` to reflect the operation `op` within the document with state `docState`.
   * `ops` is the operation sequence (as per `groupRelatedOps`) that we're currently processing.
   * Can be called multiple times if there are multiple operations for the same property (e.g. due
   * to a conflict). `propState` is an object that carries over state between such successive
   * invocations for the same property. If the current object is a list, `listIndex` is the index
   * into that list (counting only visible elements). If the operation `op` was already previously
   * in the document, `oldSuccNum` is the value of `op[succNum]` before the current change was
   * applied (allowing us to determine whether this operation was overwritten or deleted in the
   * current change). `oldSuccNum` must be undefined if the operation came from the current change.
   */
  updatePatchProperty(patches, ops, op, docState, propState, listIndex, oldSuccNum) {
    // FIXME: these constants duplicate those at the beginning of mergeDocChangeOps()
    const objActor = 0, objCtr = 1, keyActor = 2, keyCtr = 3, keyStr = 4, idActor = 5, idCtr = 6, insert = 7, action = 8, // eslint-disable-line
      valLen = 9, valRaw = 10, predNum = 13, predActor = 14, predCtr = 15, succNum = 13, succActor = 14, succCtr = 15 // eslint-disable-line

    const objectId = ops.objId
    const elemId = op[keyStr] ? op[keyStr]
                              : op[insert] ? `${op[idCtr]}@${docState.actorIds[op[idActor]]}`
                                           : `${op[keyCtr]}@${docState.actorIds[op[keyActor]]}`

    // An operation to be overwritten if it is a document operation that has at least one successor
    const isOverwritten = (oldSuccNum !== undefined && op[succNum] > 0)

    if (!patches[objectId]) patches[objectId] = {objectId, type: docState.objectMeta[objectId].type, props: {}}
    let patch = patches[objectId]

    if (op[keyStr] === null) {
      // Updating a list or text object (with opId key)
      if (!patch.edits) patch.edits = []

      // If the property has a non-overwritten/non-deleted value, it's either an insert or an update
      if (!isOverwritten) {
        if (!propState[elemId]) {
          patch.edits.push({action: 'insert', index: listIndex, elemId})
          propState[elemId] = {action: 'insert', visibleOps: [], hasChild: false}
        } else if (propState[elemId].action === 'remove') {
          patch.edits.pop()
          propState[elemId].action = 'update'
        }
      }

      // If the property formerly had a non-overwritten value, it's either a remove or an update
      if (oldSuccNum === 0) {
        if (!propState[elemId]) {
          patch.edits.push({action: 'remove', index: listIndex})
          propState[elemId] = {action: 'remove', visibleOps: [], hasChild: false}
        } else if (propState[elemId].action === 'insert') {
          patch.edits.pop()
          propState[elemId].action = 'update'
        }
      }

      if (!patch.props[listIndex] && propState[elemId] && ['insert', 'update'].includes(propState[elemId].action)) {
        patch.props[listIndex] = {}
      }
    } else {
      // Updating a map or table (with string key)
      if (!patch.props[op[keyStr]]) patch.props[op[keyStr]] = {}
    }

    // If one or more of the values of the property is a child object, we update objectMeta to store
    // all of the visible values of the property (even the non-child-object values). Then, when we
    // subsequently process an update within that child object, we can construct the patch to
    // contain the conflicting values.
    if (!isOverwritten) {
      if (!propState[elemId]) propState[elemId] = {visibleOps: [], hasChild: false}
      propState[elemId].visibleOps.push(op)
      propState[elemId].hasChild = propState[elemId].hasChild || (op[action] % 2) === 0 // even-numbered action == make* operation

      if (propState[elemId].hasChild) {
        let values = {}
        for (let visible of propState[elemId].visibleOps) {
          const opId = `${visible[idCtr]}@${docState.actorIds[visible[idActor]]}`
          if (ACTIONS[visible[action]] === 'set') {
            values[opId] = decodeValue(visible[valLen], visible[valRaw])
          } else if (visible[action] % 2 === 0) {
            const type = visible[action] < ACTIONS.length ? OBJECT_TYPE[ACTIONS[visible[action]]] : null
            values[opId] = {objectId: opId, type, props: {}}
          }
        }

        // Copy so that objectMeta is not modified if an exception is thrown while applying change
        deepCopyUpdate(docState.objectMeta, [objectId, 'children', elemId], values)
      }
    }

    const opId = `${op[idCtr]}@${docState.actorIds[op[idActor]]}`
    const key = op[keyStr] !== null ? op[keyStr] : listIndex

    // For counters, increment operations are succs to the set operation that created the counter,
    // but in this case we want to add the values rather than overwriting them.
    if (isOverwritten && ACTIONS[op[action]] === 'set' && (op[valLen] & 0x0f) === VALUE_TYPE.COUNTER) {
      // This is the initial set operation that creates a counter. Initialise the counter state
      // to contain all successors of the set operation. Only if we later find that each of these
      // successor operations is an increment, we make the counter visible in the patch.
      if (!propState[elemId]) propState[elemId] = {visibleOps: [], hasChild: false}
      if (!propState[elemId].counterStates) propState[elemId].counterStates = {}
      let counterStates = propState[elemId].counterStates
      let counterState = {opId, value: decodeValue(op[valLen], op[valRaw]).value, succs: {}}

      for (let i = 0; i < op[succNum]; i++) {
        const succOp = `${op[succCtr][i]}@${docState.actorIds[op[succActor][i]]}`
        counterStates[succOp] = counterState
        counterState.succs[succOp] = true
      }

    } else if (ACTIONS[op[action]] === 'inc') {
      // Incrementing a previously created counter.
      if (!propState[elemId] || !propState[elemId].counterStates || !propState[elemId].counterStates[opId]) {
        throw new RangeError(`increment operation ${opId} for unknown counter`)
      }
      let counterState = propState[elemId].counterStates[opId]
      counterState.value += decodeValue(op[valLen], op[valRaw]).value
      delete counterState.succs[opId]

      if (Object.keys(counterState.succs).length === 0 && patch.props[key]) {
        patch.props[key][counterState.opId] = {datatype: 'counter', value: counterState.value}
        // TODO if the counter is in a list element, we need to add a 'remove' action when deleted
      }

    } else if (patch.props[key] && !isOverwritten) {
      // Add the value to the patch if it is not overwritten (i.e. if it has no succs).
      if (ACTIONS[op[action]] === 'set') {
        patch.props[key][opId] = decodeValue(op[valLen], op[valRaw])
      } else if (op[action] % 2 === 0) { // even-numbered action == make* operation
        if (!patches[opId]) {
          const type = op[action] < ACTIONS.length ? OBJECT_TYPE[ACTIONS[op[action]]] : null
          patches[opId] = {objectId: opId, type, props: {}}
        }
        patch.props[key][opId] = patches[opId]
      }
    }
  }

  /**
   * Applies a sequence of change operations to the document. `changeCols` contains the columns of
   * the change. Assumes that the decoders of both sets of columns are at the position where we want
   * to start merging. `patches` is mutated to reflect the effect of the change operations. `ops` is
   * the operation sequence to apply (as decoded by `groupRelatedOps()`). `docState` is as
   * documented in `applyOps()`. If the operations are updating a list or text object, `listIndex`
   * is the number of visible elements that precede the position at which we start merging.
   */
  mergeDocChangeOps(patches, outCols, ops, changeCols, docState, listIndex) {
    // Check the first couple of columns are in the positions where we expect them to be
    const objActor = 0, objCtr = 1, keyActor = 2, keyCtr = 3, keyStr = 4, idActor = 5, idCtr = 6, insert = 7, action = 8,
      valLen = 9, valRaw = 10, predNum = 13, predActor = 14, predCtr = 15, succNum = 13, succActor = 14, succCtr = 15
    if (docState.opsCols[objActor ].columnId !== DOC_OPS_COLUMNS.objActor  || changeCols[objActor ].columnId !== CHANGE_COLUMNS.objActor  ||
        docState.opsCols[objCtr   ].columnId !== DOC_OPS_COLUMNS.objCtr    || changeCols[objCtr   ].columnId !== CHANGE_COLUMNS.objCtr    ||
        docState.opsCols[keyActor ].columnId !== DOC_OPS_COLUMNS.keyActor  || changeCols[keyActor ].columnId !== CHANGE_COLUMNS.keyActor  ||
        docState.opsCols[keyCtr   ].columnId !== DOC_OPS_COLUMNS.keyCtr    || changeCols[keyCtr   ].columnId !== CHANGE_COLUMNS.keyCtr    ||
        docState.opsCols[keyStr   ].columnId !== DOC_OPS_COLUMNS.keyStr    || changeCols[keyStr   ].columnId !== CHANGE_COLUMNS.keyStr    ||
        docState.opsCols[idActor  ].columnId !== DOC_OPS_COLUMNS.idActor   || changeCols[idActor  ].columnId !== CHANGE_COLUMNS.idActor   ||
        docState.opsCols[idCtr    ].columnId !== DOC_OPS_COLUMNS.idCtr     || changeCols[idCtr    ].columnId !== CHANGE_COLUMNS.idCtr     ||
        docState.opsCols[insert   ].columnId !== DOC_OPS_COLUMNS.insert    || changeCols[insert   ].columnId !== CHANGE_COLUMNS.insert    ||
        docState.opsCols[action   ].columnId !== DOC_OPS_COLUMNS.action    || changeCols[action   ].columnId !== CHANGE_COLUMNS.action    ||
        docState.opsCols[valLen   ].columnId !== DOC_OPS_COLUMNS.valLen    || changeCols[valLen   ].columnId !== CHANGE_COLUMNS.valLen    ||
        docState.opsCols[valRaw   ].columnId !== DOC_OPS_COLUMNS.valRaw    || changeCols[valRaw   ].columnId !== CHANGE_COLUMNS.valRaw    ||
        docState.opsCols[succNum  ].columnId !== DOC_OPS_COLUMNS.succNum   || changeCols[predNum  ].columnId !== CHANGE_COLUMNS.predNum   ||
        docState.opsCols[succActor].columnId !== DOC_OPS_COLUMNS.succActor || changeCols[predActor].columnId !== CHANGE_COLUMNS.predActor ||
        docState.opsCols[succCtr  ].columnId !== DOC_OPS_COLUMNS.succCtr   || changeCols[predCtr  ].columnId !== CHANGE_COLUMNS.predCtr) {
      throw new RangeError('unexpected columnId')
    }

    let opCount = ops.consecutiveOps, opsAppended = 0, opIdCtr = ops.idCtr
    let foundListElem = false, elemVisible = false, propState = {}
    let docOp = docState.opsCols[action].decoder.done ? null : readOperation(docState.opsCols)
    let docOpsConsumed = (docOp === null ? 0 : 1)
    let docOpOldSuccNum = (docOp === null ? 0 : docOp[succNum])
    let changeOp = null, nextChangeOp = null, changeOps = [], predSeen = []

    // Merge the two inputs: the sequence of ops in the doc, and the sequence of ops in the change.
    // At each iteration, we either output the doc's op (possibly updated based on the change's ops)
    // or output an op from the change.
    while (true) {
      // Read operations from the change, and fill the array `changeOps` with all the operations
      // that pertain to the same property (the same key or list element). If the operation
      // sequence consists of consecutive list insertions, `changeOps` contains all of the ops.
      if (changeOps.length === 0) {
        foundListElem = false
        while (changeOps.length === 0 || ops.insert ||
               (nextChangeOp[keyStr] !== null && nextChangeOp[keyStr] === changeOps[0][keyStr]) ||
               (nextChangeOp[keyStr] === null && nextChangeOp[keyActor] === changeOps[0][keyActor] &&
                nextChangeOp[keyCtr] === changeOps[0][keyCtr])) {
          if (nextChangeOp !== null) {
            changeOps.push(nextChangeOp)
            predSeen.push(new Array(nextChangeOp[predNum]))
          }
          if (opCount === 0) {
            nextChangeOp = null
            break
          }

          nextChangeOp = readOperation(changeCols, docState.actorTable)
          nextChangeOp[idActor] = ops.idActorIndex
          nextChangeOp[idCtr] = opIdCtr
          opCount--
          opIdCtr++
        }
      }

      if (changeOps.length > 0) changeOp = changeOps[0]
      const inCorrectObject = docOp && docOp[objActor] === changeOp[objActor] && docOp[objCtr] === changeOp[objCtr]
      const keyMatches      = docOp && docOp[keyStr] !== null && docOp[keyStr] === changeOp[keyStr]
      const listElemMatches = docOp && docOp[keyStr] === null && changeOp[keyStr] === null &&
        ((!docOp[insert] && docOp[keyActor] === changeOp[keyActor] && docOp[keyCtr] === changeOp[keyCtr]) ||
          (docOp[insert] && docOp[idActor]  === changeOp[keyActor] && docOp[idCtr]  === changeOp[keyCtr]))

      // We keep going until we run out of ops in the change, except that even when we run out, we
      // keep going until we have processed all doc ops for the current key/list element.
      if (changeOps.length === 0 && !(inCorrectObject && (keyMatches || listElemMatches))) break

      let takeDocOp = false, takeChangeOps = 0

      // The change operations come first if we are inserting list elements (seekToOp already
      // determines the correct insertion position), if there is no document operation, if the next
      // document operation is for a different object, or if the change op's string key is
      // lexicographically first (TODO check ordering of keys beyond the basic multilingual plane).
      if (ops.insert || !inCorrectObject ||
          (docOp[keyStr] === null && changeOp[keyStr] !== null) ||
          (docOp[keyStr] !== null && changeOp[keyStr] !== null && changeOp[keyStr] < docOp[keyStr])) {
        // Take the operations from the change
        takeChangeOps = changeOps.length
        if (!inCorrectObject && !foundListElem && changeOp[keyStr] === null && !changeOp[insert]) {
          // This can happen if we first update one list element, then another one earlier in the
          // list. That is not allowed: list element updates must occur in ascending order.
          throw new RangeError("could not find list element with ID: " +
                               `${changeOp[keyCtr]}@${docState.actorIds[changeOp[keyActor]]}`)
        }

      } else if (keyMatches || listElemMatches || foundListElem) {
        // The doc operation is for the same key or list element in the same object as the change
        // ops, so we merge them. First, if any of the change ops' `pred` matches the opId of the
        // document operation, we update the document operation's `succ` accordingly.
        for (let opIndex = 0; opIndex < changeOps.length; opIndex++) {
          const op = changeOps[opIndex]
          for (let i = 0; i < op[predNum]; i++) {
            if (op[predActor][i] === docOp[idActor] && op[predCtr][i] === docOp[idCtr]) {
              // Insert into the doc op's succ list such that the lists remains sorted
              let j = 0
              while (j < docOp[succNum] && (docOp[succCtr][j] < op[idCtr] ||
                     docOp[succCtr][j] === op[idCtr] && docState.actorIds[docOp[succActor][j]] < ops.idActor)) j++
              docOp[succCtr].splice(j, 0, op[idCtr])
              docOp[succActor].splice(j, 0, ops.idActorIndex)
              docOp[succNum]++
              predSeen[opIndex][i] = true
              break
            }
          }
        }

        if (listElemMatches) foundListElem = true

        if (foundListElem && !listElemMatches) {
          // If the previous docOp was for the correct list element, and the current docOp is for
          // the wrong list element, then place the current changeOp before the docOp.
          takeChangeOps = changeOps.length

        } else if (changeOps.length === 0 || docOp[idCtr] < changeOp[idCtr] ||
            (docOp[idCtr] === changeOp[idCtr] && docState.actorIds[docOp[idActor]] < ops.idActor)) {
          // When we have several operations for the same object and the same key, we want to keep
          // them sorted in ascending order by opId. Here we have docOp with a lower opId, so we
          // output it first.
          takeDocOp = true
          this.updatePatchProperty(patches, ops, docOp, docState, propState, listIndex, docOpOldSuccNum)

          // A deletion op in the change is represented in the document only by its entries in the
          // succ list of the operations it overwrites; it has no separate row in the set of ops.
          for (let i = changeOps.length - 1; i >= 0; i--) {
            let deleted = true
            for (let j = 0; j < changeOps[i][predNum]; j++) {
              if (!predSeen[i][j]) deleted = false
            }
            if (ACTIONS[changeOps[i][action]] === 'del' && deleted) {
              changeOps.splice(i, 1)
              predSeen.splice(i, 1)
            }
          }

        } else if (docOp[idCtr] === changeOp[idCtr] && docState.actorIds[docOp[idActor]] === ops.idActor) {
          throw new RangeError(`duplicate operation ID: ${changeOp[idCtr]}@${ops.idActor}`)
        } else {
          // The changeOp has the lower opId, so we output it first.
          takeChangeOps = 1
        }
      } else {
        // The document operation comes first if its string key is lexicographically first, or if
        // we're using opId keys and the keys don't match (i.e. we scan the document until we find a
        // matching key).
        takeDocOp = true
      }

      if (takeDocOp) {
        appendOperation(outCols, docState.opsCols, docOp)
        if (docOp[insert] && elemVisible) {
          elemVisible = false
          listIndex++
        }
        if (docOp[succNum] === 0) elemVisible = true
        opsAppended++
        docOp = docState.opsCols[action].decoder.done ? null : readOperation(docState.opsCols)
        if (docOp !== null) {
          docOpsConsumed++
          docOpOldSuccNum = docOp[succNum]
        }
      }

      if (takeChangeOps > 0) {
        for (let i = 0; i < takeChangeOps; i++) {
          let op = changeOps[i]
          // Check that we've seen all ops mentioned in `pred` (they must all have lower opIds than
          // the change op's own opId, so we must have seen them already)
          for (let j = 0; j < op[predNum]; j++) {
            if (!predSeen[i][j]) {
              throw new RangeError(`no matching operation for pred: ${op[predCtr][j]}@${docState.actorIds[op[predActor][j]]}`)
            }
          }
          this.updatePatchProperty(patches, ops, op, docState, propState, listIndex)
          appendOperation(outCols, changeCols, op)
          if (op[insert]) {
            elemVisible = false
            listIndex++
          } else {
            elemVisible = true
          }
        }

        if (takeChangeOps === changeOps.length) {
          changeOps.length = 0
          predSeen.length = 0
        } else {
          changeOps.splice(0, takeChangeOps)
          predSeen.splice(0, takeChangeOps)
        }
        opsAppended += takeChangeOps
      }
    }

    if (docOp) {
      appendOperation(outCols, docState.opsCols, docOp)
      opsAppended++
    }
    return {opsAppended, docOpsConsumed}
  }

  /**
   * Applies the operation sequence in `ops` (as produced by `groupRelatedOps()`) from the change
   * with columns `changeCols` to the document `docState`. `docState` is an object with keys:
   *   - `actorIds` is an array of actorIds (as hex strings) occurring in the document (values in
   *     the document's objActor/keyActor/idActor/... columns are indexes into this array).
   *   - `actorTable` is an array of integers where `actorTable[i]` contains the document's actor
   *     index for the actor that has index `i` in the change (`i == 0` is the author of the change).
   *   - `allCols` is an array of all the columnIds in either the document or the change.
   *   - `opsCols` is an array of columns containing the operations in the document.
   *   - `numOps` is an integer, the number of operations in the document.
   *   - `objectMeta` is a map from objectId to metadata about that object.
   *   - `lastIndex` is an object where the key is an objectId, and the value is the last list index
   *     accessed in that object. This is used to check that accesses occur in ascending order
   *     (which makes it easier to generate patches for lists).
   *
   * `docState` is mutated to contain the updated document state.
   * `patches` is a patch object that is mutated to reflect the operations applied by this function.
   */
  applyOps(patches, ops, changeCols, docState) {
    for (let col of docState.opsCols) col.decoder.reset()
    const {skipCount, visibleCount} = seekToOp(ops, docState.opsCols, docState.actorIds)
    if (docState.lastIndex[ops.objId] && visibleCount < docState.lastIndex[ops.objId]) {
      throw new RangeError('list element accesses must occur in ascending order')
    }
    docState.lastIndex[ops.objId] = visibleCount
    for (let col of docState.opsCols) col.decoder.reset()

    let outCols = docState.allCols.map(columnId => ({columnId, encoder: encoderByColumnId(columnId)}))
    copyColumns(outCols, docState.opsCols, skipCount)
    const {opsAppended, docOpsConsumed} = this.mergeDocChangeOps(patches, outCols, ops, changeCols, docState, visibleCount)
    copyColumns(outCols, docState.opsCols, docState.numOps - skipCount - docOpsConsumed)
    for (let col of docState.opsCols) {
      if (!col.decoder.done) throw new RangeError(`excess ops in ${col.columnName} column`)
    }

    docState.opsCols = outCols.map(col => {
      const decoder = decoderByColumnId(col.columnId, col.encoder.buffer)
      return {columnId: col.columnId, columnName: DOC_OPS_COLUMNS_REV[col.columnId], decoder}
    })
    docState.numOps = docState.numOps + opsAppended - docOpsConsumed
  }

  /**
   * Takes `changeCols`, a list of `{columnId, columnName, decoder}` objects for a change, and
   * checks that it has the expected structure. Returns an array of column IDs (integers) of the
   * columns that occur either in the document or in the change.
   */
  getAllColumns(changeCols) {
    const expectedCols = [
      'objActor', 'objCtr', 'keyActor', 'keyCtr', 'keyStr', 'idActor', 'idCtr', 'insert',
      'action', 'valLen', 'valRaw', 'chldActor', 'chldCtr', 'predNum', 'predActor', 'predCtr'
    ]
    let allCols = {}
    for (let i = 0; i < expectedCols.length; i++) {
      if (changeCols[i].columnName !== expectedCols[i]) {
        throw new RangeError(`Expected column ${expectedCols[i]} at index ${i}, got ${changeCols[i].columnName}`)
      }
    }
    for (let col of changeCols) allCols[col.columnId] = true
    for (let columnId of Object.values(DOC_OPS_COLUMNS)) allCols[columnId] = true

    // Final document should contain any columns in either the document or the change, except for
    // pred, since the document encoding uses succ instead of pred
    delete allCols[CHANGE_COLUMNS.predNum]
    delete allCols[CHANGE_COLUMNS.predActor]
    delete allCols[CHANGE_COLUMNS.predCtr]
    return Object.keys(allCols).map(id => parseInt(id, 10)).sort((a, b) => a - b)
  }

  /**
   * Takes a decoded change header, including an array of actorIds. Returns an object of the form
   * `{actorIds, actorTable}`, where `actorIds` is an updated array of actorIds appearing in the
   * document (including the new change's actorId), and `actorTable` is an array for translating
   * the change's actor indexes into the document's actor indexes.
   */
  getActorTable(actorIds, change) {
    if (actorIds.indexOf(change.actorIds[0]) < 0) {
      if (change.seq !== 1) {
        throw new RangeError(`Seq ${change.seq} is the first change for actor ${change.actorIds[0]}`)
      }
      // Use concat, not push, so that the original array is not mutated
      actorIds = actorIds.concat([change.actorIds[0]])
    }
    const actorTable = [] // translate from change's actor index to doc's actor index
    for (let actorId of change.actorIds) {
      const index = actorIds.indexOf(actorId)
      if (index < 0) {
        throw new RangeError(`actorId ${actorId} is not known to document`)
      }
      actorTable.push(index)
    }
    return {actorIds, actorTable}
  }

  /**
   * Finalises the patch for a change. `patches` is a map from objectIds to patch for that
   * particular object, `objectIds` is the array of IDs of objects that are created or updated in the
   * change, and `docState` is an object containing various bits of document state, including
   * `objectMeta`, a map from objectIds to metadata about that object (such as its parent in the
   * document tree). Mutates `patches` such that child objects are linked into their parent object,
   * all the way to the root object.
   */
  setupPatches(patches, objectIds, docState) {
    for (let objectId of objectIds) {
      let meta = docState.objectMeta[objectId], childMeta = null, patchExists = false
      while (true) {
        if (!patches[objectId]) patches[objectId] = {objectId, type: meta.type, props: {}}

        if (childMeta) {
          // key is the property name being updated. In maps and table objects, this is just q
          // string, while in list and text objects, we need to translate the elemID into an index
          let key = childMeta.parentKey
          if (meta.type === 'list' || meta.type === 'text') {
            const obj = parseOpId(objectId), elem = parseOpId(key)
            const seekPos = {
              objActor: obj.actorId,  objCtr: obj.counter,
              keyActor: elem.actorId, keyCtr: elem.counter,
              keyStr:   null,         insert: false
            }
            const { visibleCount } = seekToOp(seekPos, docState.opsCols, docState.actorIds)
            key = visibleCount
          }
          if (!patches[objectId].props[key]) patches[objectId].props[key] = {}

          let values = patches[objectId].props[key]
          for (let [opId, value] of Object.entries(meta.children[childMeta.parentKey])) {
            if (values[opId]) {
              patchExists = true
            } else if (value.objectId) {
              if (!patches[value.objectId]) patches[value.objectId] = Object.assign({}, value, {props: {}})
              values[opId] = patches[value.objectId]
            } else {
              values[opId] = value
            }
          }
          if (!values[childMeta.opId]) {
            throw new RangeError(`object metadata did not contain child entry for ${childMeta.opId}`)
          }
        }
        if (patchExists || !meta.parentObj) break
        childMeta = meta
        objectId = meta.parentObj
        meta = docState.objectMeta[objectId]
      }
    }
    return patches
  }

  /**
   * Parses the change given as a Uint8Array in `changeBuffer`, and applies it to the current
   * document. Returns a patch to apply to the frontend. If an exception is thrown, the document
   * object is not modified.
   */
  applyChanges(changeBuffers, isLocal = false) {
    let patches = {_root: {objectId: '_root', type: 'map', props: {}}}
    let docState = {
      actorIds: this.actorIds, opsCols: this.docColumns, numOps: this.numOps,
      objectMeta: Object.assign({}, this.objectMeta), lastIndex: {}
    }
    let allObjectIds = {}, changeByHash = Object.assign({}, this.changeByHash)
    let maxOp = this.maxOp, heads = {}, clock = Object.assign({}, this.clock)
    for (let head of this.heads) heads[head] = true

    let decodedChanges = []
    for (let changeBuffer of changeBuffers) {
      const change = decodeChangeColumns(changeBuffer) // { actor, seq, startOp, time, message, deps, actorIds, hash, columns }
      decodedChanges.push(change)

      for (let dep of change.deps) {
        // TODO enqueue changes that are not yet causally ready rather than throwing an exception
        if (!changeByHash[dep]) throw new RangeError(`missing dependency ${dep}`)
        delete heads[dep]
      }
      changeByHash[change.hash] = changeBuffer
      heads[change.hash] = true

      const expectedSeq = (clock[change.actor] || 0) + 1
      if (change.seq !== expectedSeq) {
        throw new RangeError(`Expected seq ${expectedSeq}, got seq ${change.seq} from actor ${change.actor}`)
      }
      clock[change.actor] = change.seq

      const changeCols = makeDecoders(change.columns, CHANGE_COLUMNS)
      docState.allCols = this.getAllColumns(changeCols)
      Object.assign(docState, this.getActorTable(docState.actorIds, change))
      const actorIndex = docState.actorIds.indexOf(change.actorIds[0])
      const {opSequences, objectIds} = groupRelatedOps(change, changeCols, docState.objectMeta)
      for (let id of objectIds) allObjectIds[id] = true
      const lastOps = opSequences[opSequences.length - 1]
      if (lastOps) maxOp = Math.max(maxOp, lastOps.idCtr + lastOps.consecutiveOps - 1)

      for (let col of changeCols) col.decoder.reset()
      for (let op of opSequences) {
        op.idActorIndex = actorIndex
        this.applyOps(patches, op, changeCols, docState)
      }
    }

    this.setupPatches(patches, Object.keys(allObjectIds), docState)

    // Update the document state at the end, so that if any of the earlier code throws an exception,
    // the document is not modified (making `applyChanges` atomic in the ACID sense).
    this.maxOp      = maxOp
    this.changes    = this.changes.concat(changeBuffers)
    this.changeByHash = changeByHash
    this.actorIds   = docState.actorIds
    this.heads      = Object.keys(heads).sort()
    this.clock      = clock
    this.docColumns = docState.opsCols
    this.numOps     = docState.numOps
    this.objectMeta = docState.objectMeta

    for (let change of decodedChanges) {
      if (change.seq === 1) this.hashesByActor[change.actor] = []
      this.hashesByActor[change.actor].push(change.hash)
    }

    let patch = {maxOp, clock, deps: this.heads, diffs: patches._root}
    if (isLocal && decodedChanges.length === 1) {
      patch.actor = decodedChanges[0].actor
      patch.seq = decodedChanges[0].seq
    }
    return patch
  }

  /**
   * Returns all the changes that need to be sent to another replica. `hashes` is a list of change
   * hashes known to the other replica. The changes in `hashes` and any of their transitive
   * dependencies will not be returned; any changes later than or concurrent to the hashes will be
   * returned. If `hashes` is an empty list, all changes are returned.
   *
   * NOTE: This function throws an exception if any of the given hashes are not known to this
   * replica. This means that if the other replica is ahead of us, this function cannot be used
   * directly to find the changes to send. TODO need to fix this.
   */
  getChanges(hashes) {
    const haveHashes = {}, changes = this.changes.map(decodeChangeColumns)
    for (let hash of hashes) haveHashes[hash] = true
    for (let i = changes.length - 1; i >= 0; i--) {
      if (haveHashes[changes[i].hash]) {
        for (let dep of changes[i].deps) haveHashes[dep] = true
      }
    }
    let result = []
    for (let i = 0; i < changes.length; i++) {
      if (!haveHashes[changes[i].hash]) {
        result.push(this.changes[i])
      }
    }
    return result
  }

  /**
   * When you attempt to apply a change whose dependencies are not satisfied, it is queued up and
   * the missing dependency's hash is returned from this method.
   */
  getMissingDeps() {
    return [] // TODO implement this
  }

  /**
   * Serialises the current document state into a single byte array.
   */
  save() {
    return encodeDocument(this.changes)
  }
}

module.exports = {
  COLUMN_TYPE, VALUE_TYPE, ACTIONS, DOC_OPS_COLUMNS, CHANGE_COLUMNS, DOCUMENT_COLUMNS,
  splitContainers, encodeChange, decodeChange, decodeChangeMeta, decodeChanges, encodeDocument, decodeDocument,
  getChangeChecksum, appendEdit, constructPatch, BackendDoc
}


/***/ }),

/***/ "./backend/encoding.js":
/*!*****************************!*\
  !*** ./backend/encoding.js ***!
  \*****************************/
/***/ (function(module) {

/**
 * UTF-8 decoding and encoding using API that is supported in Node >= 12 and modern browsers:
 * https://developer.mozilla.org/en-US/docs/Web/API/TextEncoder/encode
 * https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder/decode
 * If you're running in an environment where it's not available, please use a polyfill, such as:
 * https://github.com/anonyco/FastestSmallestTextEncoderDecoder
 */
const utf8encoder = new TextEncoder()
const utf8decoder = new TextDecoder('utf-8')

function stringToUtf8(string) {
  return utf8encoder.encode(string)
}

function utf8ToString(buffer) {
  return utf8decoder.decode(buffer)
}

/**
 * Converts a string consisting of hexadecimal digits into an Uint8Array.
 */
function hexStringToBytes(value) {
  if (typeof value !== 'string') {
    throw new TypeError('value is not a string')
  }
  if (!/^([0-9a-f][0-9a-f])*$/.test(value)) {
    throw new RangeError('value is not hexadecimal')
  }
  if (value === '') {
    return new Uint8Array(0)
  } else {
    return new Uint8Array(value.match(/../g).map(b => parseInt(b, 16)))
  }
}

/**
 * Converts a Uint8Array into the equivalent hexadecimal string.
 */
function bytesToHexString(bytes) {
  const hex = []
  for (let b of bytes) {
    if (b < 0 || b > 255) throw new RangeError(`value does not fit in one byte: ${b}`)
    hex.push(('0' + b.toString(16)).slice(-2))
  }
  return hex.join('')
}

/**
 * Wrapper around an Uint8Array that allows values to be appended to the buffer,
 * and that automatically grows the buffer when space runs out.
 */
class Encoder {
  constructor() {
    this.buf = new Uint8Array(16)
    this.offset = 0
  }

  /**
   * Returns the byte array containing the encoded data.
   */
  get buffer() {
    this.finish()
    return this.buf.subarray(0, this.offset)
  }

  /**
   * Reallocates the encoder's buffer to be bigger.
   */
  grow(minSize = 0) {
    let newSize = this.buf.byteLength * 4
    while (newSize < minSize) newSize *= 2
    const newBuf = new Uint8Array(newSize)
    newBuf.set(this.buf, 0)
    this.buf = newBuf
    return this
  }

  /**
   * Appends one byte (0 to 255) to the buffer.
   */
  appendByte(value) {
    if (this.offset >= this.buf.byteLength) this.grow()
    this.buf[this.offset] = value
    this.offset += 1
  }

  /**
   * Encodes a 32-bit nonnegative integer in a variable number of bytes using
   * the LEB128 encoding scheme (https://en.wikipedia.org/wiki/LEB128) and
   * appends it to the buffer. Returns the number of bytes written.
   */
  appendUint32(value) {
    if (!Number.isInteger(value)) throw new RangeError('value is not an integer')
    if (value < 0 || value > 0xffffffff) throw new RangeError('number out of range')

    const numBytes = Math.max(1, Math.ceil((32 - Math.clz32(value)) / 7))
    if (this.offset + numBytes > this.buf.byteLength) this.grow()

    for (let i = 0; i < numBytes; i++) {
      this.buf[this.offset + i] = (value & 0x7f) | (i === numBytes - 1 ? 0x00 : 0x80)
      value >>>= 7 // zero-filling right shift
    }
    this.offset += numBytes
    return numBytes
  }

  /**
   * Encodes a 32-bit signed integer in a variable number of bytes using the
   * LEB128 encoding scheme (https://en.wikipedia.org/wiki/LEB128) and appends
   * it to the buffer. Returns the number of bytes written.
   */
  appendInt32(value) {
    if (!Number.isInteger(value)) throw new RangeError('value is not an integer')
    if (value < -0x80000000 || value > 0x7fffffff) throw new RangeError('number out of range')

    const numBytes = Math.ceil((33 - Math.clz32(value >= 0 ? value : -value - 1)) / 7)
    if (this.offset + numBytes > this.buf.byteLength) this.grow()

    for (let i = 0; i < numBytes; i++) {
      this.buf[this.offset + i] = (value & 0x7f) | (i === numBytes - 1 ? 0x00 : 0x80)
      value >>= 7 // sign-propagating right shift
    }
    this.offset += numBytes
    return numBytes
  }

  /**
   * Encodes a nonnegative integer in a variable number of bytes using the LEB128
   * encoding scheme, up to the maximum size of integers supported by JavaScript
   * (53 bits).
   */
  appendUint53(value) {
    if (!Number.isInteger(value)) throw new RangeError('value is not an integer')
    if (value < 0 || value > Number.MAX_SAFE_INTEGER) {
      throw new RangeError('number out of range')
    }
    const high32 = Math.floor(value / 0x100000000)
    const low32 = (value & 0xffffffff) >>> 0 // right shift to interpret as unsigned
    return this.appendUint64(high32, low32)
  }

  /**
   * Encodes a signed integer in a variable number of bytes using the LEB128
   * encoding scheme, up to the maximum size of integers supported by JavaScript
   * (53 bits).
   */
  appendInt53(value) {
    if (!Number.isInteger(value)) throw new RangeError('value is not an integer')
    if (value < Number.MIN_SAFE_INTEGER || value > Number.MAX_SAFE_INTEGER) {
      throw new RangeError('number out of range')
    }
    const high32 = Math.floor(value / 0x100000000)
    const low32 = (value & 0xffffffff) >>> 0 // right shift to interpret as unsigned
    return this.appendInt64(high32, low32)
  }

  /**
   * Encodes a 64-bit nonnegative integer in a variable number of bytes using
   * the LEB128 encoding scheme, and appends it to the buffer. The number is
   * given as two 32-bit halves since JavaScript cannot accurately represent
   * integers with more than 53 bits in a single variable.
   */
  appendUint64(high32, low32) {
    if (!Number.isInteger(high32) || !Number.isInteger(low32)) {
      throw new RangeError('value is not an integer')
    }
    if (high32 < 0 || high32 > 0xffffffff || low32 < 0 || low32 > 0xffffffff) {
      throw new RangeError('number out of range')
    }
    if (high32 === 0) return this.appendUint32(low32)

    const numBytes = Math.ceil((64 - Math.clz32(high32)) / 7)
    if (this.offset + numBytes > this.buf.byteLength) this.grow()
    for (let i = 0; i < 4; i++) {
      this.buf[this.offset + i] = (low32 & 0x7f) | 0x80
      low32 >>>= 7 // zero-filling right shift
    }
    this.buf[this.offset + 4] = (low32 & 0x0f) | ((high32 & 0x07) << 4) | (numBytes === 5 ? 0x00 : 0x80)
    high32 >>>= 3
    for (let i = 5; i < numBytes; i++) {
      this.buf[this.offset + i] = (high32 & 0x7f) | (i === numBytes - 1 ? 0x00 : 0x80)
      high32 >>>= 7
    }
    this.offset += numBytes
    return numBytes
  }

  /**
   * Encodes a 64-bit signed integer in a variable number of bytes using the
   * LEB128 encoding scheme, and appends it to the buffer. The number is given
   * as two 32-bit halves since JavaScript cannot accurately represent integers
   * with more than 53 bits in a single variable. The sign of the 64-bit
   * number is determined by the sign of the `high32` half; the sign of the
   * `low32` half is ignored.
   */
  appendInt64(high32, low32) {
    if (!Number.isInteger(high32) || !Number.isInteger(low32)) {
      throw new RangeError('value is not an integer')
    }
    if (high32 < -0x80000000 || high32 > 0x7fffffff || low32 < -0x80000000 || low32 > 0xffffffff) {
      throw new RangeError('number out of range')
    }
    low32 >>>= 0 // interpret as unsigned
    if (high32 === 0 && low32 <= 0x7fffffff) return this.appendInt32(low32)
    if (high32 === -1 && low32 >= 0x80000000) return this.appendInt32(low32 - 0x100000000)

    const numBytes = Math.ceil((65 - Math.clz32(high32 >= 0 ? high32 : -high32 - 1)) / 7)
    if (this.offset + numBytes > this.buf.byteLength) this.grow()
    for (let i = 0; i < 4; i++) {
      this.buf[this.offset + i] = (low32 & 0x7f) | 0x80
      low32 >>>= 7 // zero-filling right shift
    }
    this.buf[this.offset + 4] = (low32 & 0x0f) | ((high32 & 0x07) << 4) | (numBytes === 5 ? 0x00 : 0x80)
    high32 >>= 3 // sign-propagating right shift
    for (let i = 5; i < numBytes; i++) {
      this.buf[this.offset + i] = (high32 & 0x7f) | (i === numBytes - 1 ? 0x00 : 0x80)
      high32 >>= 7
    }
    this.offset += numBytes
    return numBytes
  }

  /**
   * Appends the contents of byte buffer `data` to the buffer. Returns the
   * number of bytes appended.
   */
  appendRawBytes(data) {
    if (this.offset + data.byteLength > this.buf.byteLength) {
      this.grow(this.offset + data.byteLength)
    }
    this.buf.set(data, this.offset)
    this.offset += data.byteLength
    return data.byteLength
  }

  /**
   * Appends a UTF-8 string to the buffer, without any metadata. Returns the
   * number of bytes appended.
   */
  appendRawString(value) {
    if (typeof value !== 'string') throw new TypeError('value is not a string')
    return this.appendRawBytes(stringToUtf8(value))
  }

  /**
   * Appends the contents of byte buffer `data` to the buffer, prefixed with the
   * number of bytes in the buffer (as a LEB128-encoded unsigned integer).
   */
  appendPrefixedBytes(data) {
    this.appendUint53(data.byteLength)
    this.appendRawBytes(data)
    return this
  }

  /**
   * Appends a UTF-8 string to the buffer, prefixed with its length in bytes
   * (where the length is encoded as an unsigned LEB128 integer).
   */
  appendPrefixedString(value) {
    if (typeof value !== 'string') throw new TypeError('value is not a string')
    this.appendPrefixedBytes(stringToUtf8(value))
    return this
  }

  /**
   * Takes a value, which must be a string consisting only of hexadecimal
   * digits, maps it to a byte array, and appends it to the buffer, prefixed
   * with its length in bytes.
   */
  appendHexString(value) {
    this.appendPrefixedBytes(hexStringToBytes(value))
    return this
  }

  /**
   * Flushes any unwritten data to the buffer. Call this before reading from
   * the buffer constructed by this Encoder.
   */
  finish() {
  }
}

/**
 * Counterpart to Encoder. Wraps a Uint8Array buffer with a cursor indicating
 * the current decoding position, and allows values to be incrementally read by
 * decoding the bytes at the current position.
 */
class Decoder {
  constructor(buffer) {
    if (!(buffer instanceof Uint8Array)) {
      throw new TypeError(`Not a byte array: ${buffer}`)
    }
    this.buf = buffer
    this.offset = 0
  }

  /**
   * Returns false if there is still data to be read at the current decoding
   * position, and true if we are at the end of the buffer.
   */
  get done() {
    return this.offset === this.buf.byteLength
  }

  /**
   * Resets the cursor position, so that the next read goes back to the
   * beginning of the buffer.
   */
  reset() {
    this.offset = 0
  }

  /**
   * Moves the current decoding position forward by the specified number of
   * bytes, without decoding anything.
   */
  skip(bytes) {
    if (this.offset + bytes > this.buf.byteLength) {
      throw new RangeError('cannot skip beyond end of buffer')
    }
    this.offset += bytes
  }

  /**
   * Reads one byte (0 to 255) from the buffer.
   */
  readByte() {
    this.offset += 1
    return this.buf[this.offset - 1]
  }

  /**
   * Reads a LEB128-encoded unsigned integer from the current position in the buffer.
   * Throws an exception if the value doesn't fit in a 32-bit unsigned int.
   */
  readUint32() {
    let result = 0, shift = 0
    while (this.offset < this.buf.byteLength) {
      const nextByte = this.buf[this.offset]
      if (shift === 28 && (nextByte & 0xf0) !== 0) { // more than 5 bytes, or value > 0xffffffff
        throw new RangeError('number out of range')
      }
      result = (result | (nextByte & 0x7f) << shift) >>> 0 // right shift to interpret value as unsigned
      shift += 7
      this.offset++
      if ((nextByte & 0x80) === 0) return result
    }
    throw new RangeError('buffer ended with incomplete number')
  }

  /**
   * Reads a LEB128-encoded signed integer from the current position in the buffer.
   * Throws an exception if the value doesn't fit in a 32-bit signed int.
   */
  readInt32() {
    let result = 0, shift = 0
    while (this.offset < this.buf.byteLength) {
      const nextByte = this.buf[this.offset]
      if ((shift === 28 && (nextByte & 0x80) !== 0) || // more than 5 bytes
          (shift === 28 && (nextByte & 0x40) === 0 && (nextByte & 0x38) !== 0) || // positive int > 0x7fffffff
          (shift === 28 && (nextByte & 0x40) !== 0 && (nextByte & 0x38) !== 0x38)) { // negative int < -0x80000000
        throw new RangeError('number out of range')
      }
      result |= (nextByte & 0x7f) << shift
      shift += 7
      this.offset++

      if ((nextByte & 0x80) === 0) {
        if ((nextByte & 0x40) === 0 || shift > 28) {
          return result // positive, or negative value that doesn't need sign-extending
        } else {
          return result | (-1 << shift) // sign-extend negative integer
        }
      }
    }
    throw new RangeError('buffer ended with incomplete number')
  }

  /**
   * Reads a LEB128-encoded unsigned integer from the current position in the
   * buffer. Allows any integer that can be safely represented by JavaScript
   * (up to 2^53 - 1), and throws an exception outside of that range.
   */
  readUint53() {
    const { low32, high32 } = this.readUint64()
    if (high32 < 0 || high32 > 0x1fffff) {
      throw new RangeError('number out of range')
    }
    return high32 * 0x100000000 + low32
  }

  /**
   * Reads a LEB128-encoded signed integer from the current position in the
   * buffer. Allows any integer that can be safely represented by JavaScript
   * (between -(2^53 - 1) and 2^53 - 1), throws an exception outside of that range.
   */
  readInt53() {
    const { low32, high32 } = this.readInt64()
    if (high32 < -0x200000 || (high32 === -0x200000 && low32 === 0) || high32 > 0x1fffff) {
      throw new RangeError('number out of range')
    }
    return high32 * 0x100000000 + low32
  }

  /**
   * Reads a LEB128-encoded unsigned integer from the current position in the
   * buffer. Throws an exception if the value doesn't fit in a 64-bit unsigned
   * int. Returns the number in two 32-bit halves, as an object of the form
   * `{high32, low32}`.
   */
  readUint64() {
    let low32 = 0, high32 = 0, shift = 0
    while (this.offset < this.buf.byteLength && shift <= 28) {
      const nextByte = this.buf[this.offset]
      low32 = (low32 | (nextByte & 0x7f) << shift) >>> 0 // right shift to interpret value as unsigned
      if (shift === 28) {
        high32 = (nextByte & 0x70) >>> 4
      }
      shift += 7
      this.offset++
      if ((nextByte & 0x80) === 0) return { high32, low32 }
    }

    shift = 3
    while (this.offset < this.buf.byteLength) {
      const nextByte = this.buf[this.offset]
      if (shift === 31 && (nextByte & 0xfe) !== 0) { // more than 10 bytes, or value > 2^64 - 1
        throw new RangeError('number out of range')
      }
      high32 = (high32 | (nextByte & 0x7f) << shift) >>> 0
      shift += 7
      this.offset++
      if ((nextByte & 0x80) === 0) return { high32, low32 }
    }
    throw new RangeError('buffer ended with incomplete number')
  }

  /**
   * Reads a LEB128-encoded signed integer from the current position in the
   * buffer. Throws an exception if the value doesn't fit in a 64-bit signed
   * int. Returns the number in two 32-bit halves, as an object of the form
   * `{high32, low32}`. The `low32` half is always non-negative, and the
   * sign of the `high32` half indicates the sign of the 64-bit number.
   */
  readInt64() {
    let low32 = 0, high32 = 0, shift = 0
    while (this.offset < this.buf.byteLength && shift <= 28) {
      const nextByte = this.buf[this.offset]
      low32 = (low32 | (nextByte & 0x7f) << shift) >>> 0 // right shift to interpret value as unsigned
      if (shift === 28) {
        high32 = (nextByte & 0x70) >>> 4
      }
      shift += 7
      this.offset++
      if ((nextByte & 0x80) === 0) {
        if ((nextByte & 0x40) !== 0) { // sign-extend negative integer
          if (shift < 32) low32 = (low32 | (-1 << shift)) >>> 0
          high32 |= -1 << Math.max(shift - 32, 0)
        }
        return { high32, low32 }
      }
    }

    shift = 3
    while (this.offset < this.buf.byteLength) {
      const nextByte = this.buf[this.offset]
      // On the 10th byte there are only two valid values: all 7 value bits zero
      // (if the value is positive) or all 7 bits one (if the value is negative)
      if (shift === 31 && nextByte !== 0 && nextByte !== 0x7f) {
        throw new RangeError('number out of range')
      }
      high32 |= (nextByte & 0x7f) << shift
      shift += 7
      this.offset++
      if ((nextByte & 0x80) === 0) {
        if ((nextByte & 0x40) !== 0 && shift < 32) { // sign-extend negative integer
          high32 |= -1 << shift
        }
        return { high32, low32 }
      }
    }
    throw new RangeError('buffer ended with incomplete number')
  }

  /**
   * Extracts a subarray `length` bytes in size, starting from the current
   * position in the buffer, and moves the position forward.
   */
  readRawBytes(length) {
    const start = this.offset
    if (start + length > this.buf.byteLength) {
      throw new RangeError('subarray exceeds buffer size')
    }
    this.offset += length
    return this.buf.subarray(start, this.offset)
  }

  /**
   * Extracts `length` bytes from the buffer, starting from the current position,
   * and returns the UTF-8 string decoding of those bytes.
   */
  readRawString(length) {
    return utf8ToString(this.readRawBytes(length))
  }

  /**
   * Extracts a subarray from the current position in the buffer, prefixed with
   * its length in bytes (encoded as an unsigned LEB128 integer).
   */
  readPrefixedBytes() {
    return this.readRawBytes(this.readUint53())
  }

  /**
   * Reads a UTF-8 string from the current position in the buffer, prefixed with its
   * length in bytes (where the length is encoded as an unsigned LEB128 integer).
   */
  readPrefixedString() {
    return utf8ToString(this.readPrefixedBytes())
  }

  /**
   * Reads a byte array from the current position in the buffer, prefixed with its
   * length in bytes. Returns that byte array converted to a hexadecimal string.
   */
  readHexString() {
    return bytesToHexString(this.readPrefixedBytes())
  }
}

/**
 * An encoder that uses run-length encoding to compress sequences of repeated
 * values. The constructor argument specifies the type of values, which may be
 * either 'int', 'uint', or 'utf8'. Besides valid values of the selected
 * datatype, values may also be null.
 *
 * The encoded buffer starts with a LEB128-encoded signed integer, the
 * repetition count. The interpretation of the following values depends on this
 * repetition count:
 *   - If this number is a positive value n, the next value in the buffer
 *     (encoded as the specified datatype) is repeated n times in the sequence.
 *   - If the repetition count is a negative value -n, then the next n values
 *     (encoded as the specified datatype) in the buffer are treated as a
 *     literal, i.e. they appear in the sequence without any further
 *     interpretation or repetition.
 *   - If the repetition count is zero, then the next value in the buffer is a
 *     LEB128-encoded unsigned integer indicating the number of null values
 *     that appear at the current position in the sequence.
 *
 * After one of these three has completed, the process repeats, starting again
 * with a repetition count, until we reach the end of the buffer.
 */
class RLEEncoder extends Encoder {
  constructor(type) {
    super()
    this.type = type
    this.state = 'empty'
    this.lastValue = undefined
    this.count = 0
    this.literal = []
  }

  /**
   * Appends a new value to the sequence. If `repetitions` is given, the value is repeated
   * `repetitions` times.
   */
  appendValue(value, repetitions = 1) {
    this._appendValue(value, repetitions)
  }

  /**
   * Like `appendValue()`, but this method is not overridden by `DeltaEncoder`.
   */
  _appendValue(value, repetitions = 1) {
    if (repetitions <= 0) return
    if (this.state === 'empty') {
      this.state = (value === null ? 'nulls' : (repetitions === 1 ? 'loneValue' : 'repetition'))
      this.lastValue = value
      this.count = repetitions
    } else if (this.state === 'loneValue') {
      if (value === null) {
        this.flush()
        this.state = 'nulls'
        this.count = repetitions
      } else if (value === this.lastValue) {
        this.state = 'repetition'
        this.count = 1 + repetitions
      } else if (repetitions > 1) {
        this.flush()
        this.state = 'repetition'
        this.count = repetitions
        this.lastValue = value
      } else {
        this.state = 'literal'
        this.literal = [this.lastValue]
        this.lastValue = value
      }
    } else if (this.state === 'repetition') {
      if (value === null) {
        this.flush()
        this.state = 'nulls'
        this.count = repetitions
      } else if (value === this.lastValue) {
        this.count += repetitions
      } else if (repetitions > 1) {
        this.flush()
        this.state = 'repetition'
        this.count = repetitions
        this.lastValue = value
      } else {
        this.flush()
        this.state = 'loneValue'
        this.lastValue = value
      }
    } else if (this.state === 'literal') {
      if (value === null) {
        this.literal.push(this.lastValue)
        this.flush()
        this.state = 'nulls'
        this.count = repetitions
      } else if (value === this.lastValue) {
        this.flush()
        this.state = 'repetition'
        this.count = 1 + repetitions
      } else if (repetitions > 1) {
        this.literal.push(this.lastValue)
        this.flush()
        this.state = 'repetition'
        this.count = repetitions
        this.lastValue = value
      } else {
        this.literal.push(this.lastValue)
        this.lastValue = value
      }
    } else if (this.state === 'nulls') {
      if (value === null) {
        this.count += repetitions
      } else if (repetitions > 1) {
        this.flush()
        this.state = 'repetition'
        this.count = repetitions
        this.lastValue = value
      } else {
        this.flush()
        this.state = 'loneValue'
        this.lastValue = value
      }
    }
  }

  /**
   * Copies values from the RLEDecoder `decoder` into this encoder. The `options` object may
   * contain the following keys:
   *  - `count`: The number of values to copy. If not specified, copies all remaining values.
   *  - `sumValues`: If true, the function computes the sum of all numeric values as they are
   *    copied (null values are counted as zero), and returns that number.
   *  - `sumShift`: If set, values are shifted right by `sumShift` bits before adding to the sum.
   *
   * Returns an object of the form `{nonNullValues, sum}` where `nonNullValues` is the number of
   * non-null values copied, and `sum` is the sum (only if the `sumValues` option is set).
   */
  copyFrom(decoder, options = {}) {
    const { count, sumValues, sumShift } = options
    if (!(decoder instanceof RLEDecoder) || (decoder.type !== this.type)) {
      throw new TypeError('incompatible type of decoder')
    }
    let remaining = (typeof count === 'number' ? count : Number.MAX_SAFE_INTEGER)
    let nonNullValues = 0, sum = 0
    if (count && remaining > 0 && decoder.done) throw new RangeError(`cannot copy ${count} values`)
    if (remaining === 0 || decoder.done) return sumValues ? {nonNullValues, sum} : {nonNullValues}

    // Copy a value so that we have a well-defined starting state. NB: when super.copyFrom() is
    // called by the DeltaEncoder subclass, the following calls to readValue() and appendValue()
    // refer to the overridden methods, while later readRecord(), readRawValue() and _appendValue()
    // calls refer to the non-overridden RLEDecoder/RLEEncoder methods.
    let firstValue = decoder.readValue()
    if (firstValue === null) {
      const numNulls = Math.min(decoder.count + 1, remaining)
      remaining -= numNulls
      decoder.count -= numNulls - 1
      this.appendValue(null, numNulls)
      if (count && remaining > 0 && decoder.done) throw new RangeError(`cannot copy ${count} values`)
      if (remaining === 0 || decoder.done) return sumValues ? {nonNullValues, sum} : {nonNullValues}
      firstValue = decoder.readValue()
      if (firstValue === null) throw new RangeError('null run must be followed by non-null value')
    }
    this.appendValue(firstValue)
    remaining--
    nonNullValues++
    if (sumValues) sum += (sumShift ? (firstValue >>> sumShift) : firstValue)
    if (count && remaining > 0 && decoder.done) throw new RangeError(`cannot copy ${count} values`)
    if (remaining === 0 || decoder.done) return sumValues ? {nonNullValues, sum} : {nonNullValues}

    // Copy data at the record level without expanding repetitions
    let firstRun = (decoder.count > 0)
    while (remaining > 0 && !decoder.done) {
      if (!firstRun) decoder.readRecord()
      const numValues = Math.min(decoder.count, remaining)
      decoder.count -= numValues

      if (decoder.state === 'literal') {
        nonNullValues += numValues
        for (let i = 0; i < numValues; i++) {
          if (decoder.done) throw new RangeError('incomplete literal')
          const value = decoder.readRawValue()
          if (value === decoder.lastValue) throw new RangeError('Repetition of values is not allowed in literal')
          decoder.lastValue = value
          this._appendValue(value)
          if (sumValues) sum += (sumShift ? (value >>> sumShift) : value)
        }
      } else if (decoder.state === 'repetition') {
        nonNullValues += numValues
        if (sumValues) sum += numValues * (sumShift ? (decoder.lastValue >>> sumShift) : decoder.lastValue)
        const value = decoder.lastValue
        this._appendValue(value)
        if (numValues > 1) {
          this._appendValue(value)
          if (this.state !== 'repetition') throw new RangeError(`Unexpected state ${this.state}`)
          this.count += numValues - 2
        }
      } else if (decoder.state === 'nulls') {
        this._appendValue(null)
        if (this.state !== 'nulls') throw new RangeError(`Unexpected state ${this.state}`)
        this.count += numValues - 1
      }

      firstRun = false
      remaining -= numValues
    }
    if (count && remaining > 0 && decoder.done) throw new RangeError(`cannot copy ${count} values`)
    return sumValues ? {nonNullValues, sum} : {nonNullValues}
  }

  /**
   * Private method, do not call from outside the class.
   */
  flush() {
    if (this.state === 'loneValue') {
      this.appendInt32(-1)
      this.appendRawValue(this.lastValue)
    } else if (this.state === 'repetition') {
      this.appendInt53(this.count)
      this.appendRawValue(this.lastValue)
    } else if (this.state === 'literal') {
      this.appendInt53(-this.literal.length)
      for (let v of this.literal) this.appendRawValue(v)
    } else if (this.state === 'nulls') {
      this.appendInt32(0)
      this.appendUint53(this.count)
    }
    this.state = 'empty'
  }

  /**
   * Private method, do not call from outside the class.
   */
  appendRawValue(value) {
    if (this.type === 'int') {
      this.appendInt53(value)
    } else if (this.type === 'uint') {
      this.appendUint53(value)
    } else if (this.type === 'utf8') {
      this.appendPrefixedString(value)
    } else {
      throw new RangeError(`Unknown RLEEncoder datatype: ${this.type}`)
    }
  }

  /**
   * Flushes any unwritten data to the buffer. Call this before reading from
   * the buffer constructed by this Encoder.
   */
  finish() {
    if (this.state === 'literal') this.literal.push(this.lastValue)
    // Don't write anything if the only values we have seen are nulls
    if (this.state !== 'nulls' || this.offset > 0) this.flush()
  }
}

/**
 * Counterpart to RLEEncoder: reads values from an RLE-compressed sequence,
 * returning nulls and repeated values as required.
 */
class RLEDecoder extends Decoder {
  constructor(type, buffer) {
    super(buffer)
    this.type = type
    this.lastValue = undefined
    this.count = 0
    this.state = undefined
  }

  /**
   * Returns false if there is still data to be read at the current decoding
   * position, and true if we are at the end of the buffer.
   */
  get done() {
    return (this.count === 0) && (this.offset === this.buf.byteLength)
  }

  /**
   * Resets the cursor position, so that the next read goes back to the
   * beginning of the buffer.
   */
  reset() {
    this.offset = 0
    this.lastValue = undefined
    this.count = 0
    this.state = undefined
  }

  /**
   * Returns the next value (or null) in the sequence.
   */
  readValue() {
    if (this.done) return null
    if (this.count === 0) this.readRecord()
    this.count -= 1
    if (this.state === 'literal') {
      const value = this.readRawValue()
      if (value === this.lastValue) throw new RangeError('Repetition of values is not allowed in literal')
      this.lastValue = value
      return value
    } else {
      return this.lastValue
    }
  }

  /**
   * Discards the next `numSkip` values in the sequence.
   */
  skipValues(numSkip) {
    while (numSkip > 0 && !this.done) {
      if (this.count === 0) {
        this.count = this.readInt53()
        if (this.count > 0) {
          this.lastValue = (this.count <= numSkip) ? this.skipRawValues(1) : this.readRawValue()
          this.state = 'repetition'
        } else if (this.count < 0) {
          this.count = -this.count
          this.state = 'literal'
        } else { // this.count == 0
          this.count = this.readUint53()
          this.lastValue = null
          this.state = 'nulls'
        }
      }

      const consume = Math.min(numSkip, this.count)
      if (this.state === 'literal') this.skipRawValues(consume)
      numSkip -= consume
      this.count -= consume
    }
  }

  /**
   * Private method, do not call from outside the class.
   * Reads a repetition count from the buffer and sets up the state appropriately.
   */
  readRecord() {
    this.count = this.readInt53()
    if (this.count > 1) {
      const value = this.readRawValue()
      if ((this.state === 'repetition' || this.state === 'literal') && this.lastValue === value) {
        throw new RangeError('Successive repetitions with the same value are not allowed')
      }
      this.state = 'repetition'
      this.lastValue = value
    } else if (this.count === 1) {
      throw new RangeError('Repetition count of 1 is not allowed, use a literal instead')
    } else if (this.count < 0) {
      this.count = -this.count
      if (this.state === 'literal') throw new RangeError('Successive literals are not allowed')
      this.state = 'literal'
    } else { // this.count == 0
      if (this.state === 'nulls') throw new RangeError('Successive null runs are not allowed')
      this.count = this.readUint53()
      if (this.count === 0) throw new RangeError('Zero-length null runs are not allowed')
      this.lastValue = null
      this.state = 'nulls'
    }
  }

  /**
   * Private method, do not call from outside the class.
   * Reads one value of the datatype configured on construction.
   */
  readRawValue() {
    if (this.type === 'int') {
      return this.readInt53()
    } else if (this.type === 'uint') {
      return this.readUint53()
    } else if (this.type === 'utf8') {
      return this.readPrefixedString()
    } else {
      throw new RangeError(`Unknown RLEDecoder datatype: ${this.type}`)
    }
  }

  /**
   * Private method, do not call from outside the class.
   * Skips over `num` values of the datatype configured on construction.
   */
  skipRawValues(num) {
    if (this.type === 'utf8') {
      for (let i = 0; i < num; i++) this.skip(this.readUint53())
    } else {
      while (num > 0 && this.offset < this.buf.byteLength) {
        if ((this.buf[this.offset] & 0x80) === 0) num--
        this.offset++
      }
      if (num > 0) throw new RangeError('cannot skip beyond end of buffer')
    }
  }
}

/**
 * A variant of RLEEncoder: rather than storing the actual values passed to
 * appendValue(), this version stores only the first value, and for all
 * subsequent values it stores the difference to the previous value. This
 * encoding is good when values tend to come in sequentially incrementing runs,
 * because the delta between successive values is 1, and repeated values of 1
 * are easily compressed with run-length encoding.
 *
 * Null values are also allowed, as with RLEEncoder.
 */
class DeltaEncoder extends RLEEncoder {
  constructor() {
    super('int')
    this.absoluteValue = 0
  }

  /**
   * Appends a new integer value to the sequence. If `repetitions` is given, the value is repeated
   * `repetitions` times.
   */
  appendValue(value, repetitions = 1) {
    if (repetitions <= 0) return
    if (typeof value === 'number') {
      super.appendValue(value - this.absoluteValue, 1)
      this.absoluteValue = value
      if (repetitions > 1) super.appendValue(0, repetitions - 1)
    } else {
      super.appendValue(value, repetitions)
    }
  }

  /**
   * Copies values from the DeltaDecoder `decoder` into this encoder. The `options` object may
   * contain the key `count`, indicating the number of values to copy. If not specified, copies
   * all remaining values in the decoder.
   */
  copyFrom(decoder, options = {}) {
    if (options.sumValues) {
      throw new RangeError('unsupported options for DeltaEncoder.copyFrom()')
    }
    if (!(decoder instanceof DeltaDecoder)) {
      throw new TypeError('incompatible type of decoder')
    }

    let remaining = options.count
    if (remaining > 0 && decoder.done) throw new RangeError(`cannot copy ${remaining} values`)
    if (remaining === 0 || decoder.done) return

    // Copy any null values, and the first non-null value, so that appendValue() computes the
    // difference between the encoder's last value and the decoder's first (absolute) value.
    let value = decoder.readValue(), nulls = 0
    this.appendValue(value)
    if (value === null) {
      nulls = decoder.count + 1
      if (remaining !== undefined && remaining < nulls) nulls = remaining
      decoder.count -= nulls - 1
      this.count += nulls - 1
      if (remaining > nulls && decoder.done) throw new RangeError(`cannot copy ${remaining} values`)
      if (remaining === nulls || decoder.done) return

      // The next value read is certain to be non-null because we're not at the end of the decoder,
      // and a run of nulls must be followed by a run of non-nulls.
      if (decoder.count === 0) this.appendValue(decoder.readValue())
    }

    // Once we have the first value, the subsequent relative values can be copied verbatim without
    // any further processing. Note that the first value copied by super.copyFrom() is an absolute
    // value, while subsequent values are relative. Thus, the sum of all of the (non-null) copied
    // values must equal the absolute value of the final element copied.
    if (remaining !== undefined) remaining -= nulls + 1
    const { nonNullValues, sum } = super.copyFrom(decoder, {count: remaining, sumValues: true})
    if (nonNullValues > 0) {
      this.absoluteValue = sum
      decoder.absoluteValue = sum
    }
  }
}

/**
 * Counterpart to DeltaEncoder: reads values from a delta-compressed sequence of
 * numbers (may include null values).
 */
class DeltaDecoder extends RLEDecoder {
  constructor(buffer) {
    super('int', buffer)
    this.absoluteValue = 0
  }

  /**
   * Resets the cursor position, so that the next read goes back to the
   * beginning of the buffer.
   */
  reset() {
    this.offset = 0
    this.lastValue = undefined
    this.count = 0
    this.state = undefined
    this.absoluteValue = 0
  }

  /**
   * Returns the next integer (or null) value in the sequence.
   */
  readValue() {
    const value = super.readValue()
    if (value === null) return null
    this.absoluteValue += value
    return this.absoluteValue
  }

  /**
   * Discards the next `numSkip` values in the sequence.
   */
  skipValues(numSkip) {
    while (numSkip > 0 && !this.done) {
      if (this.count === 0) this.readRecord()
      const consume = Math.min(numSkip, this.count)
      if (this.state === 'literal') {
        for (let i = 0; i < consume; i++) {
          this.lastValue = this.readRawValue()
          this.absoluteValue += this.lastValue
        }
      } else if (this.state === 'repetition') {
        this.absoluteValue += consume * this.lastValue
      }
      numSkip -= consume
      this.count -= consume
    }
  }
}

/**
 * Encodes a sequence of boolean values by mapping it to a sequence of integers:
 * the number of false values, followed by the number of true values, followed
 * by the number of false values, and so on. Each number is encoded as a LEB128
 * unsigned integer. This encoding is a bit like RLEEncoder, except that we
 * only encode the repetition count but not the actual value, since the values
 * just alternate between false and true (starting with false).
 */
class BooleanEncoder extends Encoder {
  constructor() {
    super()
    this.lastValue = false
    this.count = 0
  }

  /**
   * Appends a new value to the sequence. If `repetitions` is given, the value is repeated
   * `repetitions` times.
   */
  appendValue(value, repetitions = 1) {
    if (value !== false && value !== true) {
      throw new RangeError(`Unsupported value for BooleanEncoder: ${value}`)
    }
    if (repetitions <= 0) return
    if (this.lastValue === value) {
      this.count += repetitions
    } else {
      this.appendUint53(this.count)
      this.lastValue = value
      this.count = repetitions
    }
  }

  /**
   * Copies values from the BooleanDecoder `decoder` into this encoder. The `options` object may
   * contain the key `count`, indicating the number of values to copy. If not specified, copies
   * all remaining values in the decoder.
   */
  copyFrom(decoder, options = {}) {
    if (!(decoder instanceof BooleanDecoder)) {
      throw new TypeError('incompatible type of decoder')
    }

    const { count } = options
    let remaining = (typeof count === 'number' ? count : Number.MAX_SAFE_INTEGER)
    if (count && remaining > 0 && decoder.done) throw new RangeError(`cannot copy ${count} values`)
    if (remaining === 0 || decoder.done) return

    // Copy one value to bring decoder and encoder state into sync, then finish that value's repetitions
    this.appendValue(decoder.readValue())
    remaining--
    const firstCopy = Math.min(decoder.count, remaining)
    this.count += firstCopy
    decoder.count -= firstCopy
    remaining -= firstCopy

    while (remaining > 0 && !decoder.done) {
      decoder.count = decoder.readUint53()
      if (decoder.count === 0) throw new RangeError('Zero-length runs are not allowed')
      decoder.lastValue = !decoder.lastValue
      this.appendUint53(this.count)

      const numCopied = Math.min(decoder.count, remaining)
      this.count = numCopied
      this.lastValue = decoder.lastValue
      decoder.count -= numCopied
      remaining -= numCopied
    }

    if (count && remaining > 0 && decoder.done) throw new RangeError(`cannot copy ${count} values`)
  }

  /**
   * Flushes any unwritten data to the buffer. Call this before reading from
   * the buffer constructed by this Encoder.
   */
  finish() {
    if (this.count > 0) {
      this.appendUint53(this.count)
      this.count = 0
    }
  }
}

/**
 * Counterpart to BooleanEncoder: reads boolean values from a runlength-encoded
 * sequence.
 */
class BooleanDecoder extends Decoder {
  constructor(buffer) {
    super(buffer)
    this.lastValue = true // is negated the first time we read a count
    this.firstRun = true
    this.count = 0
  }

  /**
   * Returns false if there is still data to be read at the current decoding
   * position, and true if we are at the end of the buffer.
   */
  get done() {
    return (this.count === 0) && (this.offset === this.buf.byteLength)
  }

  /**
   * Resets the cursor position, so that the next read goes back to the
   * beginning of the buffer.
   */
  reset() {
    this.offset = 0
    this.lastValue = true
    this.firstRun = true
    this.count = 0
  }

  /**
   * Returns the next value in the sequence.
   */
  readValue() {
    if (this.done) return false
    while (this.count === 0) {
      this.count = this.readUint53()
      this.lastValue = !this.lastValue
      if (this.count === 0 && !this.firstRun) {
        throw new RangeError('Zero-length runs are not allowed')
      }
      this.firstRun = false
    }
    this.count -= 1
    return this.lastValue
  }

  /**
   * Discards the next `numSkip` values in the sequence.
   */
  skipValues(numSkip) {
    while (numSkip > 0 && !this.done) {
      if (this.count === 0) {
        this.count = this.readUint53()
        this.lastValue = !this.lastValue
        if (this.count === 0) throw new RangeError('Zero-length runs are not allowed')
      }
      if (this.count < numSkip) {
        numSkip -= this.count
        this.count = 0
      } else {
        this.count -= numSkip
        numSkip = 0
      }
    }
  }
}

module.exports = {
  stringToUtf8, utf8ToString, hexStringToBytes, bytesToHexString,
  Encoder, Decoder, RLEEncoder, RLEDecoder, DeltaEncoder, DeltaDecoder, BooleanEncoder, BooleanDecoder
}


/***/ }),

/***/ "./backend/index.js":
/*!**************************!*\
  !*** ./backend/index.js ***!
  \**************************/
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

const { init, clone, free, applyChanges, applyLocalChange, save, load, loadChanges, getPatch, getHeads, getAllChanges, getChanges, getChangesAdded, getChangeByHash, getMissingDeps } = __webpack_require__(/*! ./backend */ "./backend/backend.js")
const { receiveSyncMessage, generateSyncMessage, encodeSyncMessage, decodeSyncMessage, encodeSyncState, decodeSyncState, initSyncState } = __webpack_require__(/*! ./sync */ "./backend/sync.js")

module.exports = {
  init, clone, free, applyChanges, applyLocalChange, save, load, loadChanges, getPatch,
  getHeads, getAllChanges, getChanges, getChangesAdded, getChangeByHash, getMissingDeps,
  receiveSyncMessage, generateSyncMessage, encodeSyncMessage, decodeSyncMessage, encodeSyncState, decodeSyncState, initSyncState
}


/***/ }),

/***/ "./backend/op_set.js":
/*!***************************!*\
  !*** ./backend/op_set.js ***!
  \***************************/
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

const { Map, List, Set, fromJS } = __webpack_require__(/*! immutable */ "./node_modules/immutable/dist/immutable.js")
const { SkipList } = __webpack_require__(/*! ./skip_list */ "./backend/skip_list.js")
const { decodeChange, decodeChangeMeta, appendEdit } = __webpack_require__(/*! ./columnar */ "./backend/columnar.js")
const { parseOpId } = __webpack_require__(/*! ../src/common */ "./src/common.js")

// Returns true if all changes that causally precede the given change
// have already been applied in `opSet`.
function causallyReady(opSet, change) {
  for (let hash of change.deps) {
    if (!opSet.hasIn(['hashes', hash])) return false
  }
  return true
}

/**
 * Returns the path from the root object to the given objectId, as an array of
 * operations describing the objects and keys traversed. If there are several
 * paths to the same object, returns one of the paths arbitrarily. Returns
 * null if there is no path (e.g. if the object has been deleted).
 */
function getPath(opSet, objectId) {
  let path = []
  while (objectId !== '_root') {
    const ref = opSet.getIn(['byObject', objectId, '_inbound'], Set()).first()
    if (!ref) return null
    path.unshift(ref)
    objectId = ref.get('obj')
  }
  return path
}

/**
 * Returns a string that is either 'map', 'table', 'list', or 'text', indicating
 * the type of the object with ID `objectId`.
 */
function getObjectType(opSet, objectId) {
  if (objectId === '_root') return 'map'
  const objInit = opSet.getIn(['byObject', objectId, '_init', 'action'])
  const type = {makeMap: 'map', makeTable: 'table', makeList: 'list', makeText: 'text'}[objInit]
  if (!type) throw new RangeError(`Unknown object type ${objInit} for ${objectId}`)
  return type
}

// Processes a 'makeMap', 'makeList', 'makeTable', or 'makeText' operation
function applyMake(opSet, op, patch) {
  const objectId = getChildId(op), action = op.get('action')
  if (opSet.hasIn(['byObject', objectId, '_keys'])) throw new Error(`Duplicate creation of object ${objectId}`)

  let object = Map({_init: op, _inbound: Set(), _keys: Map()})
  if (action === 'makeList' || action === 'makeText') {
    object = object.set('_elemIds', new SkipList())
  }
  opSet = opSet.setIn(['byObject', objectId], object)

  if (patch) {
    patch.objectId = objectId
    patch.type = getObjectType(opSet, objectId)
    patch.props = {}
    if (patch.type === 'list' || patch.type === 'text') patch.edits = []
  }
  return opSet
}

// Processes an insertion operation. Does not modify any patch because the new list element
// only becomes visible through the assignment of a value to the new list element.
function applyInsert(opSet, op) {
  const objectId = op.get('obj'), opId = op.get('opId')
  if (!opSet.get('byObject').has(objectId)) throw new Error(`Modification of unknown object ${objectId}`)
  if (opSet.hasIn(['byObject', objectId, '_insertion', opId])) throw new Error(`Duplicate list element ID ${opId}`)
  if (!op.get('elemId')) throw new RangeError('insert operation has no key')

  return opSet
    .updateIn(['byObject', objectId, '_following', op.get('elemId')], List(), list => list.push(op))
    .setIn(['byObject', objectId, '_insertion', opId], op)
}

function updateListElement(opSet, objectId, elemId, patch) {
  const ops = getFieldOps(opSet, objectId, elemId)
  let elemIds = opSet.getIn(['byObject', objectId, '_elemIds'])
  let index = elemIds.indexOf(elemId)

  if (index >= 0) {
    if (ops.isEmpty()) {
      elemIds = elemIds.removeIndex(index)
    } else {
      elemIds = elemIds.setValue(elemId, ops.first().get('value'))
    }
    setPatchEditsForList(opSet, objectId, elemId, index, false, patch)

  } else {
    if (ops.isEmpty()) return opSet // deleting a non-existent element = no-op

    // find the index of the closest preceding list element
    let prevId = elemId
    while (true) {
      index = -1
      prevId = getPrevious(opSet, objectId, prevId)
      if (!prevId) break
      index = elemIds.indexOf(prevId)
      if (index >= 0) break
    }

    index += 1
    elemIds = elemIds.insertIndex(index, elemId, ops.first().get('value'))
    setPatchEditsForList(opSet, objectId, elemId, index, true, patch)
  }
  return opSet.setIn(['byObject', objectId, '_elemIds'], elemIds)
}

/**
 * Returns true if the operation `op` introduces a child object.
 */
function isChildOp(op) {
  const action = op.get('action')
  return action.startsWith('make') || action === 'link'
}

/**
 * Returns the object ID of the child introduced by `op`.
 */
function getChildId(op) {
  return op.get('child', op.get('opId'))
}

/**
 * Returns the key that is updated by the given operation. In the case of lists and text,
 * the key is the element ID; in the case of maps, it is the property name.
 */
function getOperationKey(op) {
  const keyStr = op.get('key')
  if (keyStr) return keyStr
  const key = op.get('insert') ? op.get('opId') : op.get('elemId')
  if (!key) throw new RangeError(`operation has no key: ${op}`)
  return key
}

/**
 * Processes a 'set', 'del', 'make*', 'link', or 'inc' operation. Mutates `patch`
 * to describe the change and returns an updated `opSet`.
 */
function applyAssign(opSet, op, patch) {
  const objectId = op.get('obj'), action = op.get('action'), key = getOperationKey(op)
  if (!opSet.get('byObject').has(objectId)) throw new RangeError(`Modification of unknown object ${objectId}`)
  const type = getObjectType(opSet, objectId)

  if (patch) {
    patch.objectId = patch.objectId || objectId
    if (patch.objectId !== objectId) {
      throw new RangeError(`objectId mismatch in patch: ${patch.objectId} != ${objectId}`)
    }

    patch.type = patch.type || type
    if (patch.type !== type) {
      throw new RangeError(`object type mismatch in patch: ${patch.type} != ${type}`)
    }

    if (type !== 'list' && type !== 'text' && !patch.props[key]) patch.props[key] = {}
  }

  if (action.startsWith('make')) {
    if (patch) {
      const valuePatch = {}
      opSet = applyMake(opSet, op, valuePatch)
      if (type === 'map' || type === 'table') {
        patch.props[key][op.get('opId')] = valuePatch
      }
    } else {
      opSet = applyMake(opSet, op)
    }
  }
  if (action === 'link' && patch) {
    patch.props[key][op.get('opId')] = constructObject(opSet, getChildId(op))
  }

  const ops = getFieldOps(opSet, objectId, key)
  let overwritten, remaining

  if (action === 'inc') {
    overwritten = List()
    remaining = ops.map(other => {
      if (other.get('action') === 'set' && typeof other.get('value') === 'number' &&
          other.get('datatype') === 'counter' && op.get('pred').includes(other.get('opId'))) {
        return other.set('value', other.get('value') + op.get('value'))
      } else {
        return other
      }
    })
  } else {
    const priorOpsOverwritten = ops.groupBy(other => op.get('pred').includes(other.get('opId')))
    overwritten = priorOpsOverwritten.get(true,  List())
    remaining   = priorOpsOverwritten.get(false, List())
  }

  // If any child object references were overwritten, remove them from the index of inbound links
  for (let old of overwritten.filter(isChildOp)) {
    opSet = opSet.updateIn(['byObject', getChildId(old), '_inbound'], ops => ops.remove(old))
  }

  if (isChildOp(op)) {
    opSet = opSet.updateIn(['byObject', getChildId(op), '_inbound'], Set(), ops => ops.add(op))
  }
  if (action === 'set' || isChildOp(op)) { // not 'inc' or 'del'
    remaining = remaining.push(op)
  }
  remaining = remaining.sort(lamportCompare).reverse()
  opSet = opSet.setIn(['byObject', objectId, '_keys', key], remaining)

  if (type === 'list' || type === 'text') {
    opSet = updateListElement(opSet, objectId, key, patch)
  } else {
    setPatchPropsForMap(opSet, objectId, key, patch)
  }
  return opSet
}

/**
 * Updates `patch` with the fields required in a patch. `pathOp` is an operation
 * along the path from the root to the object being modified, as returned by
 * `getPath()`. Returns the sub-object representing the child identified by this
 * operation.
 */
function initializePatch(opSet, pathOp, patch) {
  const objectId = pathOp.get('obj'), opId = pathOp.get('opId'), key = getOperationKey(pathOp)
  const type = getObjectType(opSet, objectId)
  patch.objectId = patch.objectId || objectId
  patch.type     = patch.type     || type

  if (patch.objectId !== objectId) {
    throw new RangeError(`objectId mismatch in path: ${patch.objectId} != ${objectId}`)
  }
  if (patch.type !== type) {
    throw new RangeError(`object type mismatch in path: ${patch.type} != ${type}`)
  }

  if (!patch.props[key] || !patch.props[key][opId]) {
    if (type === 'list' || type === 'text') {
      const index = opSet.getIn(['byObject', objectId, '_elemIds']).indexOf(key)
      setPatchEditsForList(opSet, objectId, key, index, false, patch)
    } else {
      setPatchPropsForMap(opSet, objectId, key, patch)
    }
  }
  if (patch.props[key][opId] === undefined) {
    throw new RangeError(`field ops for ${key} did not contain opId ${opId}`)
  }
  return patch.props[key][opId]
}

/**
 * Constructs a patch for the value created by a particular operation.
 */
function makePatchForOperation(opSet, op) {
  if (op.get('action') === 'set') {
    const patch = {type: 'value', value: op.get('value')}
    if (op.get('datatype')) patch.datatype = op.get('datatype')
    return patch

  } else if (isChildOp(op)) {
    const childId = getChildId(op), type = getObjectType(opSet, childId)
    if (type === 'list' || type === 'text') {
      return {objectId: childId, type, props: {}, edits: []}
    } else {
      return {objectId: childId, type, props: {}}
    }

  } else {
    throw new RangeError(`Unexpected operation in field ops: ${op.get('action')}`)
  }
}

/**
 * Updates `patch` to include all the values (including conflicts) for the field
 * `key` of the object with ID `objectId`.
 */
function setPatchPropsForMap(opSet, objectId, key, patch) {
  if (!patch) return
  if (!patch.props[key]) patch.props[key] = {}

  const ops = {}
  for (let op of getFieldOps(opSet, objectId, key)) {
    const opId = op.get('opId')
    ops[opId] = true
    if (!isChildOp(op) || !patch.props[key][opId]) {
      patch.props[key][opId] = makePatchForOperation(opSet, op)
    }
  }

  // Remove any values that appear in the patch, but were not returned by getFieldOps()
  for (let opId of Object.keys(patch.props[key])) {
    if (!ops[opId]) {
      delete patch.props[key][opId]
    }
  }
}

/**
 * Updates `patch` to include edits for all the values at a particular index. This is usually one
 * edit, but may be multiple in the case of a conflict at this list element.
 */
function setPatchEditsForList(opSet, listId, elemId, index, insert, patch) {
  if (!patch) return
  setPatchPropsForMap(opSet, listId, elemId, patch)
  if (Object.keys(patch.props[elemId]).length === 0) {
    appendEdit(patch.edits, {action: 'remove', index, count: 1})
    return
  }

  // If the most recent existing edit is for the same index, we need to remove it, since the patch
  // format for lists treats several consecutive updates for the same index as a conflict.
  while (!insert && patch.edits.length > 0 && patch.edits[patch.edits.length - 1].index === index &&
         ['insert', 'update'].includes(patch.edits[patch.edits.length - 1].action)) {
    const previousEdit = patch.edits.pop()
    insert = (previousEdit.action === 'insert')
  }

  for (const opId of Object.keys(patch.props[elemId]).sort(opIdCompare)) {
    const value = patch.props[elemId][opId]
    if (insert) {
      appendEdit(patch.edits, {action: 'insert', index, elemId, opId, value})
    } else {
      appendEdit(patch.edits, {action: 'update', index, opId, value})
    }
    insert = false
  }
}

/**
 * Recursively walks a patch, removing any internal information that should not be returned through
 * the API. This should be done after all the changes have been applied, since we need to preserve
 * the internal information across several calls to `OpSet.addChange()`.
 */
function finalizePatch(diff) {
  if (!diff) return
  if (diff.type === 'list' || diff.type === 'text') {
    delete diff.props // this is the actual property being deleted
    for (let edit of diff.edits) finalizePatch(edit.value)
  } else if (diff.type === 'map' || diff.type === 'table') {
    for (const prop of Object.keys(diff.props)) {
      for (const opId of Object.keys(diff.props[prop])) {
        finalizePatch(diff.props[prop][opId])
      }
    }
  }
}

/**
 * Applies the operations in the `change` to `opSet`. As a side-effect, `patch`
 * is mutated to describe the changes. Returns the updated `opSet`.
 */
function applyOps(opSet, change, patch) {
  const actor = change.get('actor'), startOp = change.get('startOp')
  let newObjects = Set()
  change.get('ops').forEach((op, index) => {
    const action = op.get('action'), obj = op.get('obj'), insert = op.get('insert')
    if (!['set', 'del', 'inc', 'link', 'makeMap', 'makeList', 'makeText', 'makeTable'].includes(action)) {
      throw new RangeError(`Unknown operation action: ${action}`)
    }
    if (!op.get('pred')) {
      throw new RangeError(`Missing 'pred' field in operation ${op}`)
    }

    let localPatch
    if (patch) {
      const path = getPath(opSet, obj)
      if (path !== null) {
        localPatch = patch
        for (let pathOp of path) localPatch = initializePatch(opSet, pathOp, localPatch)
      }
    }

    const opWithId = op.merge({opId: `${startOp + index}@${actor}`})
    if (insert) {
      opSet = applyInsert(opSet, opWithId)
    }
    if (action.startsWith('make')) {
      newObjects = newObjects.add(getChildId(opWithId))
    }
    opSet = applyAssign(opSet, opWithId, localPatch)
  })
  return opSet
}

/**
 * Applies the changeset `change` to `opSet` (unless it has already been applied,
 * in which case we do nothing). As a side-effect, `patch` is mutated to describe
 * the changes. Returns the updated `opSet`.
 */
function applyChange(opSet, binaryChange, patch) {
  const change = fromJS(decodeChange(binaryChange))
  const actor = change.get('actor'), seq = change.get('seq'), startOp = change.get('startOp'), hash = change.get('hash')
  if (typeof actor !== 'string' || typeof seq !== 'number' || typeof startOp !== 'number') {
    throw new TypeError(`Missing change metadata: actor = ${actor}, seq = ${seq}, startOp = ${startOp}`)
  }
  if (opSet.hasIn(['hashes', hash])) return opSet // change already applied, return unchanged

  const expectedSeq = opSet.getIn(['states', actor], List()).size + 1
  if (seq !== expectedSeq) {
    throw new RangeError(`Expected change ${expectedSeq} by ${actor}, got change ${seq}`)
  }

  let maxOpId = 0
  for (let depHash of change.get('deps')) {
    const depOpId = opSet.getIn(['hashes', depHash, 'maxOpId'])
    if (depOpId === undefined) throw new RangeError(`Unknown dependency hash ${depHash}`)
    maxOpId = Math.max(maxOpId, depOpId)
    opSet = opSet.updateIn(['hashes', depHash, 'depsFuture'], Set(), future => future.add(hash))
  }
  if (startOp !== maxOpId + 1) {
    throw new RangeError(`Expected startOp to be ${maxOpId + 1}, was ${startOp}`)
  }

  let queue = change.get('deps'), sameActorDep = (seq === 1)
  while (!sameActorDep && !queue.isEmpty()) {
    const dep = opSet.getIn(['hashes', queue.first()])
    queue = queue.shift()
    if (dep.get('actor') === actor && dep.get('seq') === seq - 1) {
      sameActorDep = true
    } else {
      queue = queue.concat(dep.get('depsPast'))
    }
  }
  if (!sameActorDep) {
    throw new RangeError('Change lacks dependency on prior sequence number by the same actor')
  }

  const changeInfo = Map({
    actor, seq, startOp,
    change: binaryChange,
    maxOpId: startOp + change.get('ops').size - 1,
    depsPast: change.get('deps').toSet(),
    depsFuture: Set()
  })

  opSet = applyOps(opSet, change, patch)
  return opSet
    .setIn(['hashes', hash], changeInfo)
    .updateIn(['states', actor], List(), prior => prior.push(hash))
    .update('deps', deps => deps.subtract(change.get('deps')).add(hash))
    .update('maxOp', maxOp => Math.max(maxOp, changeInfo.get('maxOpId')))
    .update('history', history => history.push(hash))
}

function applyQueuedOps(opSet, patch) {
  let queue = List()
  while (true) {
    for (let change of opSet.get('queue')) {
      if (causallyReady(opSet, decodeChangeMeta(change, false))) {
        opSet = applyChange(opSet, change, patch)
      } else {
        queue = queue.push(change)
      }
    }

    if (queue.count() === opSet.get('queue').count()) return opSet
    opSet = opSet.set('queue', queue)
    queue = List()
  }
}

function init() {
  return Map()
    .set('states',   Map())
    .set('history',  List())
    .set('byObject', Map().set('_root', Map().set('_keys', Map())))
    .set('hashes',   Map())
    .set('deps',     Set())
    .set('maxOp',     0)
    .set('queue',    List())
}

/**
 * Adds `change` to `opSet` without any modification
 * (e.g. because it's a remote change, or we have loaded it from disk). `change`
 * is given as an Immutable.js Map object. `patch` is mutated to describe the
 * change (in the format used by patches).
 */
function addChange(opSet, change, patch) {
  opSet = opSet.update('queue', queue => queue.push(change))
  return applyQueuedOps(opSet, patch)
}

/**
 * Applies a change made by the local user and adds it to `opSet`. The `change`
 * is given as an Immutable.js Map object. `patch` is mutated to describe the
 * change (in the format used by patches).
 */
function addLocalChange(opSet, change, patch) {
  return applyChange(opSet, change, patch)
}

/**
 * Returns an array of hashes of the current "head" changes (i.e. those changes
 * that no other change depends on).
 */
function getHeads(opSet) {
  return opSet.get('deps').toArray().sort()
}

/**
 * If `opSet` has applied a change with the given `hash` (given as a hexadecimal
 * string), returns that change (as a byte array). Returns undefined if no
 * change with that hash has been applied. A change with missing dependencies
 * does not count as having been applied.
 */
function getChangeByHash(opSet, hash) {
  return opSet.getIn(['hashes', hash, 'change'])
}

/**
 * Returns all the changes in `opSet` that need to be sent to another replica.
 * `haveDeps` is an Immutable.js List object containing the hashes (as hex
 * strings) of the heads that the other replica has. Those changes in `haveDeps`
 * and any of their transitive dependencies will not be returned; any changes
 * later than or concurrent to the hashes in `haveDeps` will be returned.
 * If `haveDeps` is an empty list, all changes are returned. Throws an exception
 * if any of the given hashes are not known to this replica.
 */
function getMissingChanges(opSet, haveDeps) {
  // If the other replica has nothing, return all changes in history order
  if (haveDeps.isEmpty()) {
    return opSet.get('history').toArray().map(hash => getChangeByHash(opSet, hash))
  }

  // Fast path for the common case where all new changes depend only on haveDeps
  let stack = List(), seenHashes = {}, toReturn = []
  for (let hash of haveDeps) {
    seenHashes[hash] = true
    const successors = opSet.getIn(['hashes', hash, 'depsFuture'])
    if (!successors) throw new RangeError(`hash not found: ${hash}`)
    stack = stack.concat(successors)
  }

  // Depth-first traversal of the hash graph to find all changes that depend on `haveDeps`
  while (!stack.isEmpty()) {
    const hash = stack.last()
    seenHashes[hash] = true
    toReturn.push(hash)
    if (!opSet.getIn(['hashes', hash, 'depsPast']).every(dep => seenHashes[dep])) {
      // If a change depends on a hash we have not seen, abort the traversal and fall back to the
      // slower algorithm. This will sometimes abort even if all new changes depend on `haveDeps`,
      // because our depth-first traversal is not necessarily a topological sort of the graph.
      break
    }
    stack = stack.pop().concat(opSet.getIn(['hashes', hash, 'depsFuture']))
  }

  // If the traversal above has encountered all the heads, and was not aborted early due to
  // a missing dependency, then the set of changes it has found is complete, so we can return it
  if (stack.isEmpty() && opSet.get('deps').every(head => seenHashes[head])) {
    return toReturn.map(hash => getChangeByHash(opSet, hash))
  }

  // If we haven't encountered all of the heads, we have to search harder. This will happen if
  // changes were added that are concurrent to `haveDeps`
  stack = haveDeps; seenHashes = {}
  while (!stack.isEmpty()) {
    const hash = stack.last()
    stack = stack.pop()
    if (!seenHashes[hash]) {
      const deps = opSet.getIn(['hashes', hash, 'depsPast'])
      if (!deps) throw new RangeError(`hash not found: ${hash}`)
      stack = stack.concat(deps)
      seenHashes[hash] = true
    }
  }

  return opSet.get('history')
    .filter(hash => !seenHashes[hash])
    .map(hash => getChangeByHash(opSet, hash))
    .toArray()
}

/**
 * Returns all changes that are present in `opSet2` but not present in `opSet1`.
 */
function getChangesAdded(opSet1, opSet2) {
  // Depth-first traversal from the heads through the dependency graph,
  // until we reach a change that is already present in opSet1
  let stack = opSet2.get('deps').toArray(), seenHashes = {}, toReturn = []
  while (stack.length > 0) {
    const hash = stack.pop()
    if (!seenHashes[hash] && !getChangeByHash(opSet1, hash)) {
      seenHashes[hash] = true
      toReturn.push(hash)
      stack.push(...opSet2.getIn(['hashes', hash, 'depsPast']))
    }
  }

  // Return those changes in the reverse of the order in which the depth-first search
  // found them. This is not necessarily a topological sort, but should usually be close.
  return toReturn.reverse().map(hash => getChangeByHash(opSet2, hash))
}

/**
 * Returns the hashes of any missing dependencies, i.e. where we have applied a
 * change that has a dependency on a change we have not seen.
 *
 * If the argument `heads` is given (an array of hexadecimal strings representing
 * hashes as returned by `getHeads()`), this function also ensures that all of
 * those hashes resolve to either a change that has been applied to the document,
 * or that has been enqueued for later application once missing dependencies have
 * arrived. Any missing heads hashes are included in the returned array.
 */
function getMissingDeps(opSet, heads = []) {
  let missing = {}, inQueue = {}
  for (let binaryChange of opSet.get('queue')) {
    const change = decodeChangeMeta(binaryChange, true)
    inQueue[change.hash] = true
    for (let depHash of change.deps) {
      if (!opSet.hasIn(['hashes', depHash])) missing[depHash] = true
    }
  }
  for (let head of heads) {
    if (!opSet.hasIn(['hashes', head])) missing[head] = true
  }
  return Object.keys(missing).filter(hash => !inQueue[hash]).sort()
}

function getFieldOps(opSet, objectId, key) {
  return opSet.getIn(['byObject', objectId, '_keys', key], List())
}

function getParent(opSet, objectId, key) {
  if (key === '_head') return
  const insertion = opSet.getIn(['byObject', objectId, '_insertion', key])
  if (!insertion) throw new TypeError(`Missing index entry for list element ${key}`)
  return insertion.get('elemId')
}

/**
 * Compares the opIds of two operations using Lamport timestamp ordering
 */
function lamportCompare(op1, op2) {
  return opIdCompare(op1.get('opId'), op2.get('opId'))
}

/**
 * Compares two opIds using Lamport timestamp ordering
 */
function opIdCompare(id1, id2) {
  const time1 = parseOpId(id1), time2 = parseOpId(id2)
  if (time1.counter < time2.counter) return -1
  if (time1.counter > time2.counter) return  1
  if (time1.actorId < time2.actorId) return -1
  if (time1.actorId > time2.actorId) return  1
  return 0
}

function insertionsAfter(opSet, objectId, parentId, childId) {
  let childKey = null
  if (childId) childKey = Map({opId: childId})

  return opSet
    .getIn(['byObject', objectId, '_following', parentId], List())
    .filter(op => op.get('insert') && (!childKey || lamportCompare(op, childKey) < 0))
    .sort(lamportCompare)
    .reverse() // descending order
    .map(op => op.get('opId'))
}

function getNext(opSet, objectId, key) {
  const children = insertionsAfter(opSet, objectId, key)
  if (!children.isEmpty()) return children.first()

  let ancestor
  while (true) {
    ancestor = getParent(opSet, objectId, key)
    if (!ancestor) return
    const siblings = insertionsAfter(opSet, objectId, ancestor, key)
    if (!siblings.isEmpty()) return siblings.first()
    key = ancestor
  }
}

// Given the ID of a list element, returns the ID of the immediate predecessor list element,
// or null if the given list element is at the head.
function getPrevious(opSet, objectId, key) {
  const parentId = getParent(opSet, objectId, key)
  let children = insertionsAfter(opSet, objectId, parentId)
  if (children.first() === key) {
    if (parentId === '_head') return null; else return parentId
  }

  let prevId
  for (let child of children) {
    if (child === key) break
    prevId = child
  }
  while (true) {
    children = insertionsAfter(opSet, objectId, prevId)
    if (children.isEmpty()) return prevId
    prevId = children.last()
  }
}

function constructField(opSet, op) {
  if (isChildOp(op)) {
    return constructObject(opSet, getChildId(op))
  } else if (op.get('action') === 'set') {
    const result = {value: op.get('value')}
    if (op.get('datatype')) result.datatype = op.get('datatype')
    return result
  } else {
    throw new TypeError(`Unexpected operation action: ${op.get('action')}`)
  }
}

function constructMap(opSet, objectId, type) {
  const patch = {objectId, type, props: {}}
  for (let [key, fieldOps] of opSet.getIn(['byObject', objectId, '_keys']).entries()) {
    if (!fieldOps.isEmpty()) {
      patch.props[key] = {}
      for (let op of fieldOps) {
        patch.props[key][op.get('opId')] = constructField(opSet, op)
      }
    }
  }
  return patch
}

function constructList(opSet, objectId, type) {
  const patch = {objectId, type, props: {}, edits: []}
  let elemId = '_head', index = 0, maxCounter = 0

  while (true) {
    elemId = getNext(opSet, objectId, elemId)
    if (!elemId) {
      return patch
    }
    maxCounter = Math.max(maxCounter, parseOpId(elemId).counter)

    const fieldOps = getFieldOps(opSet, objectId, elemId)
    if (!fieldOps.isEmpty()) {
      patch.props[index] = {}
      for (let op of fieldOps) {
        patch.props[index][op.get('opId')] = constructField(opSet, op)
      }
      index += 1
    }
  }
}

function constructObject(opSet, objectId) {
  const type = getObjectType(opSet, objectId)
  if (type === 'map' || type === 'table') {
    return constructMap(opSet, objectId, type)
  } else if (type === 'list' || type === 'text') {
    return constructList(opSet, objectId, type)
  } else {
    throw new RangeError(`Unknown object type: ${type}`)
  }
}

module.exports = {
  init, addChange, addLocalChange, getHeads,
  getChangeByHash, getMissingChanges, getChangesAdded, getMissingDeps,
  constructObject, getFieldOps, getOperationKey, finalizePatch
}


/***/ }),

/***/ "./backend/skip_list.js":
/*!******************************!*\
  !*** ./backend/skip_list.js ***!
  \******************************/
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

const { Map } = __webpack_require__(/*! immutable */ "./node_modules/immutable/dist/immutable.js")

// Returns a random number from the geometric distribution with p = 0.75.
// That is, returns k with probability p * (1 - p)^(k - 1).
// For example, returns 1 with probability 3/4, returns 2 with probability 3/16,
// returns 3 with probability 3/64, and so on.
function randomLevel() {
  // NOTE: this function used to be a generator; it has been converted to a regular
  // function (that mimics the interface of a generator) to avoid having to include
  // generator polyfills in the distribution build.
  return {
    next() {
      // Create random number between 0 and 2^32 - 1
      const rand = Math.floor(Math.random() * 0x100000000)
      // Count leading zeros in that 32-bit number
      let level = 1
      while (rand < 1 << (32 - 2 * level) && level < 16) level += 1
      return { value: level, done: false }
    }
  }
}

class Node {
  constructor (key, value, level, prevKey, nextKey, prevCount, nextCount) {
    this.key = key
    this.value = value
    this.level = level
    this.prevKey = prevKey
    this.nextKey = nextKey
    this.prevCount = prevCount
    this.nextCount = nextCount
  }

  setValue (value) {
    return new Node(this.key, value, this.level, this.prevKey, this.nextKey,
                    this.prevCount, this.nextCount)
  }

  insertAfter (newKey, newLevel, fromLevel, distance) {
    if (newLevel > this.level && this.key !== null) {
      throw new RangeError('Cannot increase the level of a non-head node')
    }
    const maxLevel = Math.max(this.level, newLevel)
    const nextKey = this.nextKey.slice()
    const nextCount = this.nextCount.slice()

    for (let level = fromLevel; level < maxLevel; level++) {
      if (level < newLevel) {
        nextKey[level] = newKey
        nextCount[level] = distance
      } else {
        nextCount[level] += 1
      }
    }

    return new Node(this.key, this.value, maxLevel,
                    this.prevKey, nextKey, this.prevCount, nextCount)
  }

  insertBefore (newKey, newLevel, fromLevel, distance) {
    if (newLevel > this.level) throw new RangeError('Cannot increase node level')
    const prevKey = this.prevKey.slice()
    const prevCount = this.prevCount.slice()

    for (let level = fromLevel; level < this.level; level++) {
      if (level < newLevel) {
        prevKey[level] = newKey
        prevCount[level] = distance
      } else {
        prevCount[level] += 1
      }
    }

    return new Node(this.key, this.value, this.level,
                    prevKey, this.nextKey, prevCount, this.nextCount)
  }

  removeAfter (fromLevel, removedLevel, newKeys, distances) {
    const nextKey = this.nextKey.slice()
    const nextCount = this.nextCount.slice()

    for (let level = fromLevel; level < this.level; level++) {
      if (level < removedLevel) {
        nextKey[level] = newKeys[level]
        nextCount[level] = distances[level]
      } else {
        nextCount[level] -= 1
      }
    }

    return new Node(this.key, this.value, this.level,
                    this.prevKey, nextKey, this.prevCount, nextCount)
  }

  removeBefore (fromLevel, removedLevel, newKeys, distances) {
    const prevKey = this.prevKey.slice()
    const prevCount = this.prevCount.slice()

    for (let level = fromLevel; level < this.level; level++) {
      if (level < removedLevel) {
        prevKey[level] = newKeys[level]
        prevCount[level] = distances[level]
      } else {
        prevCount[level] -= 1
      }
    }

    return new Node(this.key, this.value, this.level,
                    prevKey, this.nextKey, prevCount, this.nextCount)
  }
}

class SkipList {
  constructor (randomSource) {
    const head = new Node(null, null, 1, [], [null], [], [null])
    const random = randomSource ? randomSource() : randomLevel()
    return makeInstance(0, Map().set(null, head), random) // eslint-disable-line
  }

  get headNode () {
    return this._nodes.get(null)
  }

  predecessors (predecessor, maxLevel) {
    const preKeys = [predecessor], preCounts = [1]

    for (let level = 1; level < maxLevel; level++) {
      let preKey = preKeys[level - 1]
      let count = preCounts[level - 1]
      while (preKey) {
        let node = this._nodes.get(preKey)
        if (node.level > level) break
        if (node.level < level) {
          throw new RangeError('Node ' + preKey + ' below expected level ' + (level - 1))
        }
        count += node.prevCount[level - 1]
        preKey = node.prevKey[level - 1]
      }
      preKeys[level] = preKey
      preCounts[level] = count
    }

    return {preKeys, preCounts}
  }

  successors (successor, maxLevel) {
    const sucKeys = [successor], sucCounts = [1]

    for (let level = 1; level < maxLevel; level++) {
      let sucKey = sucKeys[level - 1]
      let count = sucCounts[level - 1]
      while (sucKey) {
        let node = this._nodes.get(sucKey)
        if (node.level > level) break
        if (node.level < level) {
          throw new RangeError('Node ' + sucKey + ' below expected level ' + (level - 1))
        }
        count += node.nextCount[level - 1]
        sucKey = node.nextKey[level - 1]
      }
      sucKeys[level] = sucKey
      sucCounts[level] = count
    }

    return {sucKeys, sucCounts}
  }

  // Inserts a new list element immediately after the element with key `predecessor`.
  // If predecessor === null, inserts at the head of the list.
  insertAfter (predecessor, key, value) {
    if (typeof key !== 'string' || key === '') {
      throw new RangeError('Key must be a nonempty string')
    }
    if (!this._nodes.has(predecessor)) {
      throw new RangeError('The referenced predecessor key does not exist')
    }
    if (this._nodes.has(key)) {
      throw new RangeError('Cannot insert a key that already exists')
    }

    const newLevel = this._randomSource.next().value
    const maxLevel = Math.max(newLevel, this.headNode.level)
    const successor = this._nodes.get(predecessor).nextKey[0] || null
    const { preKeys, preCounts } = this.predecessors(predecessor, maxLevel)
    const { sucKeys, sucCounts } = this.successors(successor, maxLevel)

    return makeInstance(this.length + 1, this._nodes.withMutations(nodes => {
      let preLevel = 0, sucLevel = 0
      for (let level = 1; level <= maxLevel; level++) {
        const updateLevel = Math.min(level, newLevel)
        if (level === maxLevel || preKeys[level] !== preKeys[preLevel]) {
          nodes.update(preKeys[preLevel],
                       node => node.insertAfter(key, updateLevel, preLevel, preCounts[preLevel]))
          preLevel = level
        }
        if (sucKeys[sucLevel] && (level === maxLevel || sucKeys[level] !== sucKeys[sucLevel])) {
          nodes.update(sucKeys[sucLevel],
                       node => node.insertBefore(key, updateLevel, sucLevel, sucCounts[sucLevel]))
          sucLevel = level
        }
      }

      nodes.set(key, new Node(key, value, newLevel,
                              preKeys.slice(0, newLevel),
                              sucKeys.slice(0, newLevel),
                              preCounts.slice(0, newLevel),
                              sucCounts.slice(0, newLevel)))
    }), this._randomSource)
  }

  insertIndex (index, key, value) {
    if (typeof index !== 'number' || index < 0) {
      throw new RangeError('Index must be a non-negative integer')
    }
    if (index === 0) {
      return this.insertAfter(null, key, value)
    } else {
      return this.insertAfter(this.keyOf(index - 1), key, value)
    }
  }

  removeKey (key) {
    if (typeof key !== 'string' || !this._nodes.has(key)) {
      throw new RangeError('The given key cannot be removed because it does not exist')
    }
    const removedNode = this._nodes.get(key)
    const maxLevel = this.headNode.level
    const { preKeys, preCounts } = this.predecessors(removedNode.prevKey[0], maxLevel)
    const { sucKeys, sucCounts } = this.successors  (removedNode.nextKey[0], maxLevel)
    const distances = new Array(maxLevel)

    for (let level = 0; level < maxLevel; level++) {
      distances[level] = preCounts[level] + sucCounts[level] - 1
    }

    return makeInstance(this.length - 1, this._nodes.withMutations(nodes => {
      nodes.remove(key)
      let preLevel = 0, sucLevel = 0

      for (let level = 1; level <= maxLevel; level++) {
        const updateLevel = Math.min(level, removedNode.level)
        if (level === maxLevel || preKeys[level] !== preKeys[preLevel]) {
          nodes.update(preKeys[preLevel],
                       node => node.removeAfter(preLevel, updateLevel, sucKeys, distances))
          preLevel = level
        }
        if (sucKeys[sucLevel] && (level === maxLevel || sucKeys[level] !== sucKeys[sucLevel])) {
          nodes.update(sucKeys[sucLevel],
                       node => node.removeBefore(sucLevel, updateLevel, preKeys, distances))
          sucLevel = level
        }
      }
    }), this._randomSource)
  }

  removeIndex (index) {
    return this.removeKey(this.keyOf(index))
  }

  indexOf (key) {
    if (typeof key !== 'string' || key === '' || !this._nodes.has(key)) return -1
    let node = this._nodes.get(key), count = 0
    while (node && node.key) {
      count += node.prevCount[node.level - 1]
      node = this._nodes.get(node.prevKey[node.level - 1])
    }
    return count - 1
  }

  keyOf (index) {
    if (typeof index !== 'number') return null
    if (index < 0) index = index + this.length
    if (index < 0 || index >= this.length) return null

    let node = this._nodes.get(null), level = node.level - 1, count = 0
    while (true) {
      if (count === index + 1) {
        return node.key
      } else if (count + node.nextCount[level] > index + 1) {
        level -= 1
      } else {
        count += node.nextCount[level]
        node = this._nodes.get(node.nextKey[level])
      }
    }
  }

  getValue (key) {
    if (typeof key !== 'string' || key === '') {
      throw new RangeError('Key must be a nonempty string')
    }
    const node = this._nodes.get(key)
    return node && node.value
  }

  setValue (key, value) {
    if (typeof key !== 'string' || key === '') {
      throw new RangeError('Key must be a nonempty string')
    }
    let node = this._nodes.get(key)
    if (!node) throw new RangeError('The referenced key does not exist')

    node = node.setValue(value)
    return makeInstance(this.length, this._nodes.set(key, node), this._randomSource)
  }

  iterator (mode) {
    // NOTE: this method used to be a generator; it has been converted to a regular
    // method (that mimics the interface of a generator) to avoid having to include
    // generator polyfills in the distribution build.
    const nodes = this._nodes
    let key = nodes.get(null).nextKey[0]
    return {
      next () {
        if (!key) return { value: undefined, done: true }
        const node = nodes.get(key)
        let rval = undefined
        switch (mode) {
          case 'keys':    rval = {value: key,               done: false}; break
          case 'values':  rval = {value: node.value,        done: false}; break
          case 'entries': rval = {value: [key, node.value], done: false}; break
        }
        key = node.nextKey[0]
        return rval
      },
      [Symbol.iterator]: () => this.iterator(mode),
    }
  }

  [Symbol.iterator] () {
    return this.iterator('values')
  }
}

function makeInstance(length, nodes, randomSource) {
  const instance = Object.create(SkipList.prototype)
  instance.length = length
  instance._nodes = nodes
  instance._randomSource = randomSource
  return instance
}

module.exports = {SkipList}


/***/ }),

/***/ "./backend/sync.js":
/*!*************************!*\
  !*** ./backend/sync.js ***!
  \*************************/
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

/**
 * Implementation of the data synchronisation protocol that brings a local and a remote document
 * into the same state. This is typically used when two nodes have been disconnected for some time,
 * and need to exchange any changes that happened while they were disconnected. The two nodes that
 * are syncing could be client and server, or server and client, or two peers with symmetric roles.
 *
 * The protocol is based on this paper: Martin Kleppmann and Heidi Howard. Byzantine Eventual
 * Consistency and the Fundamental Limits of Peer-to-Peer Databases. https://arxiv.org/abs/2012.00472
 *
 * The protocol assumes that every time a node successfully syncs with another node, it remembers
 * the current heads (as returned by `Backend.getHeads()`) after the last sync with that node. The
 * next time we try to sync with the same node, we start from the assumption that the other node's
 * document version is no older than the outcome of the last sync, so we only need to exchange any
 * changes that are more recent than the last sync. This assumption may not be true if the other
 * node did not correctly persist its state (perhaps it crashed before writing the result of the
 * last sync to disk), and we fall back to sending the entire document in this case.
 */

const { List } = __webpack_require__(/*! immutable */ "./node_modules/immutable/dist/immutable.js")
const { backendState } = __webpack_require__(/*! ./util */ "./backend/util.js")
const Backend = __webpack_require__(/*! ./backend */ "./backend/backend.js")
const OpSet = __webpack_require__(/*! ./op_set */ "./backend/op_set.js")
const { hexStringToBytes, bytesToHexString, Encoder, Decoder } = __webpack_require__(/*! ./encoding */ "./backend/encoding.js")
const { decodeChangeMeta } = __webpack_require__(/*! ./columnar */ "./backend/columnar.js")
const { copyObject } = __webpack_require__(/*! ../src/common */ "./src/common.js")

const HASH_SIZE = 32 // 256 bits = 32 bytes
const MESSAGE_TYPE_SYNC = 0x42 // first byte of a sync message, for identification
const PEER_STATE_TYPE = 0x43 // first byte of an encoded peer state, for identification

// These constants correspond to a 1% false positive rate. The values can be changed without
// breaking compatibility of the network protocol, since the parameters used for a particular
// Bloom filter are encoded in the wire format.
const BITS_PER_ENTRY = 10, NUM_PROBES = 7

/**
 * A Bloom filter implementation that can be serialised to a byte array for transmission
 * over a network. The entries that are added are assumed to already be SHA-256 hashes,
 * so this implementation does not perform its own hashing.
 */
class BloomFilter {
  constructor (arg) {
    if (Array.isArray(arg)) {
      // arg is an array of SHA256 hashes in hexadecimal encoding
      this.numEntries = arg.length
      this.numBitsPerEntry = BITS_PER_ENTRY
      this.numProbes = NUM_PROBES
      this.bits = new Uint8Array(Math.ceil(this.numEntries * this.numBitsPerEntry / 8))
      for (let hash of arg) this.addHash(hash)
    } else if (arg instanceof Uint8Array) {
      if (arg.byteLength === 0) {
        this.numEntries = 0
        this.numBitsPerEntry = 0
        this.numProbes = 0
        this.bits = arg
      } else {
        const decoder = new Decoder(arg)
        this.numEntries = decoder.readUint32()
        this.numBitsPerEntry = decoder.readUint32()
        this.numProbes = decoder.readUint32()
        this.bits = decoder.readRawBytes(Math.ceil(this.numEntries * this.numBitsPerEntry / 8))
      }
    } else {
      throw new TypeError('invalid argument')
    }
  }

  /**
   * Returns the Bloom filter state, encoded as a byte array.
   */
  get bytes() {
    if (this.numEntries === 0) return new Uint8Array(0)
    const encoder = new Encoder()
    encoder.appendUint32(this.numEntries)
    encoder.appendUint32(this.numBitsPerEntry)
    encoder.appendUint32(this.numProbes)
    encoder.appendRawBytes(this.bits)
    return encoder.buffer
  }

  /**
   * Given a SHA-256 hash (as hex string), returns an array of probe indexes indicating which bits
   * in the Bloom filter need to be tested or set for this particular entry. We do this by
   * interpreting the first 12 bytes of the hash as three little-endian 32-bit unsigned integers,
   * and then using triple hashing to compute the probe indexes. The algorithm comes from:
   *
   * Peter C. Dillinger and Panagiotis Manolios. Bloom Filters in Probabilistic Verification.
   * 5th International Conference on Formal Methods in Computer-Aided Design (FMCAD), November 2004.
   * http://www.ccis.northeastern.edu/home/pete/pub/bloom-filters-verification.pdf
   */
  getProbes(hash) {
    const hashBytes = hexStringToBytes(hash), modulo = 8 * this.bits.byteLength
    if (hashBytes.byteLength !== 32) throw new RangeError(`Not a 256-bit hash: ${hash}`)
    // on the next three lines, the right shift means interpret value as unsigned
    let x = ((hashBytes[0] | hashBytes[1] << 8 | hashBytes[2]  << 16 | hashBytes[3]  << 24) >>> 0) % modulo
    let y = ((hashBytes[4] | hashBytes[5] << 8 | hashBytes[6]  << 16 | hashBytes[7]  << 24) >>> 0) % modulo
    let z = ((hashBytes[8] | hashBytes[9] << 8 | hashBytes[10] << 16 | hashBytes[11] << 24) >>> 0) % modulo
    const probes = [x]
    for (let i = 1; i < this.numProbes; i++) {
      x = (x + y) % modulo
      y = (y + z) % modulo
      probes.push(x)
    }
    return probes
  }

  /**
   * Sets the Bloom filter bits corresponding to a given SHA-256 hash (given as hex string).
   */
  addHash(hash) {
    for (let probe of this.getProbes(hash)) {
      this.bits[probe >>> 3] |= 1 << (probe & 7)
    }
  }

  /**
   * Tests whether a given SHA-256 hash (given as hex string) is contained in the Bloom filter.
   */
  containsHash(hash) {
    if (this.numEntries === 0) return false
    for (let probe of this.getProbes(hash)) {
      if ((this.bits[probe >>> 3] & (1 << (probe & 7))) === 0) {
        return false
      }
    }
    return true
  }
}

/**
 * Encodes a sorted array of SHA-256 hashes (as hexadecimal strings) into a byte array.
 */
function encodeHashes(encoder, hashes) {
  if (!Array.isArray(hashes)) throw new TypeError('hashes must be an array')
  encoder.appendUint32(hashes.length)
  for (let i = 0; i < hashes.length; i++) {
    if (i > 0 && hashes[i - 1] >= hashes[i]) throw new RangeError('hashes must be sorted')
    const bytes = hexStringToBytes(hashes[i])
    if (bytes.byteLength !== HASH_SIZE) throw new TypeError('heads hashes must be 256 bits')
    encoder.appendRawBytes(bytes)
  }
}

/**
 * Decodes a byte array in the format returned by encodeHashes(), and returns its content as an
 * array of hex strings.
 */
function decodeHashes(decoder) {
  let length = decoder.readUint32(), hashes = []
  for (let i = 0; i < length; i++) {
    hashes.push(bytesToHexString(decoder.readRawBytes(HASH_SIZE)))
  }
  return hashes
}

/**
 * Takes a sync message of the form `{heads, need, have, changes}` and encodes it as a byte array for
 * transmission.
 */
function encodeSyncMessage(message) {
  const encoder = new Encoder()
  encoder.appendByte(MESSAGE_TYPE_SYNC)
  encodeHashes(encoder, message.heads)
  encodeHashes(encoder, message.need)
  encoder.appendUint32(message.have.length)
  for (let have of message.have) {
    encodeHashes(encoder, have.lastSync)
    encoder.appendPrefixedBytes(have.bloom)
  }
  encoder.appendUint32(message.changes.length)
  for (let change of message.changes) {
    encoder.appendPrefixedBytes(change)
  }
  return encoder.buffer
}

/**
 * Takes a binary-encoded sync message and decodes it into the form `{heads, need, have, changes}`.
 */
function decodeSyncMessage(bytes) {
  const decoder = new Decoder(bytes)
  const messageType = decoder.readByte()
  if (messageType !== MESSAGE_TYPE_SYNC) {
    throw new RangeError(`Unexpected message type: ${messageType}`)
  }
  const heads = decodeHashes(decoder)
  const need = decodeHashes(decoder)
  const haveCount = decoder.readUint32()
  let message = {heads, need, have: [], changes: []}
  for (let i = 0; i < haveCount; i++) {
    const lastSync = decodeHashes(decoder)
    const bloom = decoder.readPrefixedBytes(decoder)
    message.have.push({lastSync, bloom})
  }
  const changeCount = decoder.readUint32()
  for (let i = 0; i < changeCount; i++) {
    const change = decoder.readPrefixedBytes()
    message.changes.push(change)
  }
  // Ignore any trailing bytes -- they can be used for extensions by future versions of the protocol
  return message
}

/**
 * Takes a SyncState and encodes as a byte array those parts of the state that should persist across
 * an application restart or disconnect and reconnect. The ephemeral parts of the state that should
 * be cleared on reconnect are not encoded.
 */
function encodeSyncState(syncState) {
  const encoder = new Encoder()
  encoder.appendByte(PEER_STATE_TYPE)
  encodeHashes(encoder, syncState.sharedHeads)
  return encoder.buffer
}

/**
 * Takes a persisted peer state as encoded by `encodeSyncState` and decodes it into a SyncState
 * object. The parts of the peer state that were not encoded are initialised with default values.
 */
function decodeSyncState(bytes) {
  const decoder = new Decoder(bytes)
  const recordType = decoder.readByte()
  if (recordType !== PEER_STATE_TYPE) {
    throw new RangeError(`Unexpected record type: ${recordType}`)
  }
  const sharedHeads = decodeHashes(decoder)
  return Object.assign(initSyncState(), { sharedHeads })
}

/**
 * Constructs a Bloom filter containing all changes that are not one of the hashes in
 * `lastSync` or its transitive dependencies. In other words, the filter contains those
 * changes that have been applied since the version identified by `lastSync`. Returns
 * an object of the form `{lastSync, bloom}` as required for the `have` field of a sync
 * message.
 */
function makeBloomFilter(backend, lastSync) {
  const newChanges = OpSet.getMissingChanges(backend.get('opSet'), List(lastSync))
  const hashes = newChanges.map(change => decodeChangeMeta(change, true).hash)
  return {lastSync, bloom: new BloomFilter(hashes).bytes}
}

/**
 * Call this function when a sync message is received from another node. The `message` argument
 * needs to already have been decoded using `decodeSyncMessage()`. This function determines the
 * changes that we need to send to the other node in response. Returns an array of changes (as
 * byte arrays).
 */
function getChangesToSend(backend, have, need) {
  const opSet = backend.get('opSet')
  if (have.length === 0) {
    return need.map(hash => OpSet.getChangeByHash(opSet, hash)).filter(change => change !== undefined)
  }

  let lastSyncHashes = {}, bloomFilters = []
  for (let h of have) {
    for (let hash of h.lastSync) lastSyncHashes[hash] = true
    bloomFilters.push(new BloomFilter(h.bloom))
  }

  // Get all changes that were added since the last sync
  const changes = OpSet.getMissingChanges(opSet, List(Object.keys(lastSyncHashes)))
    .map(change => decodeChangeMeta(change, true))

  let changeHashes = {}, dependents = {}, hashesToSend = {}
  for (let change of changes) {
    changeHashes[change.hash] = true

    // For each change, make a list of changes that depend on it
    for (let dep of change.deps) {
      if (!dependents[dep]) dependents[dep] = []
      dependents[dep].push(change.hash)
    }

    // Exclude any change hashes contained in one or more Bloom filters
    if (bloomFilters.every(bloom => !bloom.containsHash(change.hash))) {
      hashesToSend[change.hash] = true
    }
  }

  // Include any changes that depend on a Bloom-negative change
  let stack = Object.keys(hashesToSend)
  while (stack.length > 0) {
    const hash = stack.pop()
    if (dependents[hash]) {
      for (let dep of dependents[hash]) {
        if (!hashesToSend[dep]) {
          hashesToSend[dep] = true
          stack.push(dep)
        }
      }
    }
  }

  // Include any explicitly requested changes
  let changesToSend = []
  for (let hash of need) {
    hashesToSend[hash] = true
    if (!changeHashes[hash]) { // Change is not among those returned by getMissingChanges()?
      const change = OpSet.getChangeByHash(opSet, hash)
      if (change) changesToSend.push(change)
    }
  }

  // Return changes in the order they were returned by getMissingChanges()
  for (let change of changes) {
    if (hashesToSend[change.hash]) changesToSend.push(change.change)
  }
  return changesToSend
}

function initSyncState() {
  return {
    sharedHeads: [],
    lastSentHeads: [],
    theirHeads: null,
    theirNeed: null,
    theirHave: null,
    sentHashes: {},
  }
}

function compareArrays(a, b) {
    return (a.length === b.length) && a.every((v, i) => v === b[i])
}

/**
 * Given a backend and what we believe to be the state of our peer, generate a message which tells
 * them about we have and includes any changes we believe they need
 */
function generateSyncMessage(backend, syncState) {
  if (!backend) {
    throw new Error("generateSyncMessage called with no Automerge document")
  }
  if (!syncState) {
    throw new Error("generateSyncMessage requires a syncState, which can be created with initSyncState()")
  }

  let { sharedHeads, lastSentHeads, theirHeads, theirNeed, theirHave, sentHashes } = syncState
  const ourHeads = Backend.getHeads(backend)
  const state = backendState(backend)

  // Hashes to explicitly request from the remote peer: any missing dependencies of unapplied
  // changes, and any of the remote peer's heads that we don't know about
  const ourNeed = Backend.getMissingDeps(backend, theirHeads || [])

  // There are two reasons why ourNeed may be nonempty: 1. we might be missing dependencies due to
  // Bloom filter false positives; 2. we might be missing heads that the other peer mentioned
  // because they (intentionally) only sent us a subset of changes. In case 1, we leave the `have`
  // field of the message empty because we just want to fill in the missing dependencies for now.
  // In case 2, or if ourNeed is empty, we send a Bloom filter to request any unsent changes.
  let ourHave = []
  if (!theirHeads || ourNeed.every(hash => theirHeads.includes(hash))) {
    ourHave = [makeBloomFilter(state, sharedHeads)]
  }

  // Fall back to a full re-sync if the sender's last sync state includes hashes
  // that we don't know. This could happen if we crashed after the last sync and
  // failed to persist changes that the other node already sent us.
  if (theirHave && theirHave.length > 0) {
    const lastSync = theirHave[0].lastSync
    if (!lastSync.every(hash => Backend.getChangeByHash(backend, hash))) {
      // we need to queue them to send us a fresh sync message, the one they sent is uninteligible so we don't know what they need
      const resetMsg = {heads: ourHeads, need: [], have: [{ lastSync: [], bloom: new Uint8Array(0) }], changes: []}
      return [syncState, encodeSyncMessage(resetMsg)]
    }
  }

  // XXX: we should limit ourselves to only sending a subset of all the messages, probably limited by a total message size
  //      these changes should ideally be RLE encoded but we haven't implemented that yet.
  let changesToSend = Array.isArray(theirHave) && Array.isArray(theirNeed) ? getChangesToSend(state, theirHave, theirNeed) : []

  // If the heads are equal, we're in sync and don't need to do anything further
  const headsUnchanged = Array.isArray(lastSentHeads) && compareArrays(ourHeads, lastSentHeads)
  const headsEqual = Array.isArray(theirHeads) && compareArrays(ourHeads, theirHeads)
  if (headsUnchanged && headsEqual && changesToSend.length === 0) {
    // no need to send a sync message if we know we're synced!
    return [syncState, null]
  }

  // TODO: this recomputes the SHA-256 hash of each change; we should restructure this to avoid the
  // unnecessary recomputation
  changesToSend = changesToSend.filter(change => !sentHashes[decodeChangeMeta(change, true).hash])

  // Regular response to a sync message: send any changes that the other node
  // doesn't have. We leave the "have" field empty because the previous message
  // generated by `syncStart` already indicated what changes we have.
  const syncMessage = {heads: ourHeads, have: ourHave, need: ourNeed, changes: changesToSend}
  if (changesToSend.length > 0) {
    sentHashes = copyObject(sentHashes)
    for (const change of changesToSend) {
      sentHashes[decodeChangeMeta(change, true).hash] = true
    }
  }

  syncState = Object.assign({}, syncState, {lastSentHeads: ourHeads, sentHashes})
  return [syncState, encodeSyncMessage(syncMessage)]
}

/**
 * Computes the heads that we share with a peer after we have just received some changes from that
 * peer and applied them. This may not be sufficient to bring our heads in sync with the other
 * peer's heads, since they may have only sent us a subset of their outstanding changes.
 *
 * `myOldHeads` are the local heads before the most recent changes were applied, `myNewHeads` are
 * the local heads after those changes were applied, and `ourOldSharedHeads` is the previous set of
 * shared heads. Applying the changes will have replaced some heads with others, but some heads may
 * have remained unchanged (because they are for branches on which no changes have been added). Any
 * such unchanged heads remain in the sharedHeads. Any sharedHeads that were replaced by applying
 * changes are also replaced as sharedHeads. This is safe because if we received some changes from
 * another peer, that means that peer had those changes, and therefore we now both know about them.
 */
function advanceHeads(myOldHeads, myNewHeads, ourOldSharedHeads) {
  const newHeads = myNewHeads.filter((head) => !myOldHeads.includes(head))
  const commonHeads = ourOldSharedHeads.filter((head) => myNewHeads.includes(head))
  const advancedHeads = [...new Set([...newHeads, ...commonHeads])].sort()
  return advancedHeads
}


/**
 * Given a backend, a message message and the state of our peer, apply any changes, update what
 * we believe about the peer, and (if there were applied changes) produce a patch for the frontend
 */
function receiveSyncMessage(backend, oldSyncState, binaryMessage) {
  if (!backend) {
    throw new Error("generateSyncMessage called with no Automerge document")
  }
  if (!oldSyncState) {
    throw new Error("generateSyncMessage requires a syncState, which can be created with initSyncState()")
  }

  let { sharedHeads, lastSentHeads, sentHashes } = oldSyncState, patch = null
  const message = decodeSyncMessage(binaryMessage)
  const beforeHeads = Backend.getHeads(backend)

  // If we received changes, we try to apply them to the document. There may still be missing
  // dependencies due to Bloom filter false positives, in which case the backend will enqueue the
  // changes without applying them. The set of changes may also be incomplete if the sender decided
  // to break a large set of changes into chunks.
  if (message.changes.length > 0) {
    [backend, patch] = Backend.applyChanges(backend, message.changes)
    sharedHeads = advanceHeads(beforeHeads, Backend.getHeads(backend), sharedHeads)
  }

  // If heads are equal, indicate we don't need to send a response message
  if (message.changes.length === 0 && compareArrays(message.heads, beforeHeads)) {
    lastSentHeads = message.heads
  }

  // If all of the remote heads are known to us, that means either our heads are equal, or we are
  // ahead of the remote peer. In this case, take the remote heads to be our shared heads.
  const knownHeads = message.heads.filter(head => Backend.getChangeByHash(backend, head))
  if (knownHeads.length === message.heads.length) {
    sharedHeads = message.heads
    // If the remote peer has lost all its data, reset our state to perform a full resync
    if (message.heads.length === 0) {
      lastSentHeads = []
      sentHashes = []
    }
  } else {
    // If some remote heads are unknown to us, we add all the remote heads we know to
    // sharedHeads, but don't remove anything from sharedHeads. This might cause sharedHeads to
    // contain some redundant hashes (where one hash is actually a transitive dependency of
    // another), but this will be cleared up as soon as we know all the remote heads.
    sharedHeads = [...new Set(knownHeads.concat(sharedHeads))].sort()
  }

  const syncState = {
    sharedHeads, // what we have in common to generate an efficient bloom filter
    lastSentHeads,
    theirHave: message.have, // the information we need to calculate the changes they need
    theirHeads: message.heads,
    theirNeed: message.need,
    sentHashes
  }
  return [backend, syncState, patch]
}

module.exports = {
  receiveSyncMessage, generateSyncMessage,
  encodeSyncMessage, decodeSyncMessage,
  initSyncState, encodeSyncState, decodeSyncState,
  BloomFilter // BloomFilter is a private API, exported only for testing purposes
}


/***/ }),

/***/ "./backend/util.js":
/*!*************************!*\
  !*** ./backend/util.js ***!
  \*************************/
/***/ (function(module) {

function backendState(backend) {
  if (backend.frozen) {
    throw new Error(
      'Attempting to use an outdated Automerge document that has already been updated. ' +
      'Please use the latest document state, or call Automerge.clone() if you really ' +
      'need to use this old document state.'
    )
  }
  return backend.state
}

module.exports = {
  backendState
}


/***/ }),

/***/ "./frontend/apply_patch.js":
/*!*********************************!*\
  !*** ./frontend/apply_patch.js ***!
  \*********************************/
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

const { isObject, copyObject, parseOpId } = __webpack_require__(/*! ../src/common */ "./src/common.js")
const { OBJECT_ID, CONFLICTS, ELEM_IDS } = __webpack_require__(/*! ./constants */ "./frontend/constants.js")
const { instantiateText } = __webpack_require__(/*! ./text */ "./frontend/text.js")
const { instantiateTable } = __webpack_require__(/*! ./table */ "./frontend/table.js")
const { Counter } = __webpack_require__(/*! ./counter */ "./frontend/counter.js")

/**
 * Reconstructs the value from the patch object `patch`.
 */
function getValue(patch, object, updated) {
  if (patch.objectId) {
    // If the objectId of the existing object does not match the objectId in the patch,
    // that means the patch is replacing the object with a new one made from scratch
    if (object && object[OBJECT_ID] !== patch.objectId) {
      object = undefined
    }
    return interpretPatch(patch, object, updated)
  } else if (patch.datatype === 'timestamp') {
    // Timestamp: value is milliseconds since 1970 epoch
    return new Date(patch.value)
  } else if (patch.datatype === 'counter') {
    return new Counter(patch.value)
  } else {
    // Primitive value (int, uint, float64, string, boolean, or null)
    return patch.value
  }
}

/**
 * Compares two strings, interpreted as Lamport timestamps of the form
 * 'counter@actorId'. Returns 1 if ts1 is greater, or -1 if ts2 is greater.
 */
function lamportCompare(ts1, ts2) {
  const regex = /^(\d+)@(.*)$/
  const time1 = regex.test(ts1) ? parseOpId(ts1) : {counter: 0, actorId: ts1}
  const time2 = regex.test(ts2) ? parseOpId(ts2) : {counter: 0, actorId: ts2}
  if (time1.counter < time2.counter) return -1
  if (time1.counter > time2.counter) return  1
  if (time1.actorId < time2.actorId) return -1
  if (time1.actorId > time2.actorId) return  1
  return 0
}

/**
 * `props` is an object of the form:
 * `{key1: {opId1: {...}, opId2: {...}}, key2: {opId3: {...}}}`
 * where the outer object is a mapping from property names to inner objects,
 * and the inner objects are a mapping from operation ID to sub-patch.
 * This function interprets that structure and updates the objects `object` and
 * `conflicts` to reflect it. For each key, the greatest opId (by Lamport TS
 * order) is chosen as the default resolution; that op's value is assigned
 * to `object[key]`. Moreover, all the opIds and values are packed into a
 * conflicts object of the form `{opId1: value1, opId2: value2}` and assigned
 * to `conflicts[key]`. If there is no conflict, the conflicts object contains
 * just a single opId-value mapping.
 */
function applyProperties(props, object, conflicts, updated) {
  if (!props) return

  for (let key of Object.keys(props)) {
    const values = {}, opIds = Object.keys(props[key]).sort(lamportCompare).reverse()
    for (let opId of opIds) {
      const subpatch = props[key][opId]
      if (conflicts[key] && conflicts[key][opId]) {
        values[opId] = getValue(subpatch, conflicts[key][opId], updated)
      } else {
        values[opId] = getValue(subpatch, undefined, updated)
      }
    }

    if (opIds.length === 0) {
      delete object[key]
      delete conflicts[key]
    } else {
      object[key] = values[opIds[0]]
      conflicts[key] = values
    }
  }
}

/**
 * Creates a writable copy of an immutable map object. If `originalObject`
 * is undefined, creates an empty object with ID `objectId`.
 */
function cloneMapObject(originalObject, objectId) {
  const object    = copyObject(originalObject)
  const conflicts = copyObject(originalObject ? originalObject[CONFLICTS] : undefined)
  Object.defineProperty(object, OBJECT_ID, {value: objectId})
  Object.defineProperty(object, CONFLICTS, {value: conflicts})
  return object
}

/**
 * Updates the map object `obj` according to the modifications described in
 * `patch`, or creates a new object if `obj` is undefined. Mutates `updated`
 * to map the objectId to the new object, and returns the new object.
 */
function updateMapObject(patch, obj, updated) {
  const objectId = patch.objectId
  if (!updated[objectId]) {
    updated[objectId] = cloneMapObject(obj, objectId)
  }

  const object = updated[objectId]
  applyProperties(patch.props, object, object[CONFLICTS], updated)
  return object
}

/**
 * Updates the table object `obj` according to the modifications described in
 * `patch`, or creates a new object if `obj` is undefined. Mutates `updated`
 * to map the objectId to the new object, and returns the new object.
 */
function updateTableObject(patch, obj, updated) {
  const objectId = patch.objectId
  if (!updated[objectId]) {
    updated[objectId] = obj ? obj._clone() : instantiateTable(objectId)
  }

  const object = updated[objectId]

  for (let key of Object.keys(patch.props || {})) {
    const opIds = Object.keys(patch.props[key])

    if (opIds.length === 0) {
      object.remove(key)
    } else if (opIds.length === 1) {
      const subpatch = patch.props[key][opIds[0]]
      object._set(key, getValue(subpatch, object.byId(key), updated), opIds[0])
    } else {
      throw new RangeError('Conflicts are not supported on properties of a table')
    }
  }
  return object
}

/**
 * Creates a writable copy of an immutable list object. If `originalList` is
 * undefined, creates an empty list with ID `objectId`.
 */
function cloneListObject(originalList, objectId) {
  const list = originalList ? originalList.slice() : [] // slice() makes a shallow clone
  const conflicts = (originalList && originalList[CONFLICTS]) ? originalList[CONFLICTS].slice() : []
  const elemIds = (originalList && originalList[ELEM_IDS]) ? originalList[ELEM_IDS].slice() : []
  Object.defineProperty(list, OBJECT_ID, {value: objectId})
  Object.defineProperty(list, CONFLICTS, {value: conflicts})
  Object.defineProperty(list, ELEM_IDS,  {value: elemIds})
  return list
}

/**
 * Updates the list object `obj` according to the modifications described in
 * `patch`, or creates a new object if `obj` is undefined. Mutates `updated`
 * to map the objectId to the new object, and returns the new object.
 */
function updateListObject(patch, obj, updated) {
  const objectId = patch.objectId
  if (!updated[objectId]) {
    updated[objectId] = cloneListObject(obj, objectId)
  }

  const list = updated[objectId], conflicts = list[CONFLICTS], elemIds = list[ELEM_IDS]
  for (let i = 0; i < patch.edits.length; i++) {
    const edit = patch.edits[i]

    if (edit.action === 'insert' || edit.action === 'update') {
      const oldValue = conflicts[edit.index] && conflicts[edit.index][edit.opId]
      let lastValue = getValue(edit.value, oldValue, updated)
      let values = {[edit.opId]: lastValue}

      // Successive updates for the same index are an indication of a conflict on that list element.
      // Edits are sorted in increasing order by Lamport timestamp, so the last value (with the
      // greatest timestamp) is the default resolution of the conflict.
      while (i < patch.edits.length - 1 && patch.edits[i + 1].index === edit.index &&
             patch.edits[i + 1].action === 'update') {
        i++
        const conflict = patch.edits[i]
        const oldValue2 = conflicts[conflict.index] && conflicts[conflict.index][conflict.opId]
        lastValue = getValue(conflict.value, oldValue2, updated)
        values[conflict.opId] = lastValue
      }

      if (edit.action === 'insert') {
        list.splice(edit.index, 0, lastValue)
        conflicts.splice(edit.index, 0, values)
        elemIds.splice(edit.index, 0, edit.elemId)
      } else {
        list[edit.index] = lastValue
        conflicts[edit.index] = values
      }

    } else if (edit.action === 'multi-insert') {
      const startElemId = parseOpId(edit.elemId), newElems = [], newValues = [], newConflicts = []
      const datatype = edit.datatype
      edit.values.forEach((value, index) => {
        const elemId = `${startElemId.counter + index}@${startElemId.actorId}`
        value = getValue({ value, datatype }, undefined, updated)
        newValues.push(value)
        newConflicts.push({[elemId]: {value, datatype, type: 'value'}})
        newElems.push(elemId)
      })
      list.splice(edit.index, 0, ...newValues)
      conflicts.splice(edit.index, 0, ...newConflicts)
      elemIds.splice(edit.index, 0, ...newElems)

    } else if (edit.action === 'remove') {
      list.splice(edit.index, edit.count)
      conflicts.splice(edit.index, edit.count)
      elemIds.splice(edit.index, edit.count)
    }
  }
  return list
}

/**
 * Updates the text object `obj` according to the modifications described in
 * `patch`, or creates a new object if `obj` is undefined. Mutates `updated`
 * to map the objectId to the new object, and returns the new object.
 */
function updateTextObject(patch, obj, updated) {
  const objectId = patch.objectId
  let elems
  if (updated[objectId]) {
    elems = updated[objectId].elems
  } else if (obj) {
    elems = obj.elems.slice()
  } else {
    elems = []
  }

  for (const edit of patch.edits) {
    if (edit.action === 'insert') {
      const value = getValue(edit.value, undefined, updated)
      const elem = {elemId: edit.elemId, pred: [edit.opId], value}
      elems.splice(edit.index, 0, elem)

    } else if (edit.action === 'multi-insert') {
      const startElemId = parseOpId(edit.elemId)
      const datatype = edit.datatype
      const newElems = edit.values.map((value, index) => {
        value = getValue({ datatype, value }, undefined, updated)
        const elemId = `${startElemId.counter + index}@${startElemId.actorId}`
        return {elemId, pred: [elemId], value}
      })
      elems.splice(edit.index, 0, ...newElems)

    } else if (edit.action === 'update') {
      const elemId = elems[edit.index].elemId
      const value = getValue(edit.value, elems[edit.index].value, updated)
      elems[edit.index] = {elemId, pred: [edit.opId], value}

    } else if (edit.action === 'remove') {
      elems.splice(edit.index, edit.count)
    }
  }

  updated[objectId] = instantiateText(objectId, elems)
  return updated[objectId]
}

/**
 * Applies the patch object `patch` to the read-only document object `obj`.
 * Clones a writable copy of `obj` and places it in `updated` (indexed by
 * objectId), if that has not already been done. Returns the updated object.
 */
function interpretPatch(patch, obj, updated) {
  // Return original object if it already exists and isn't being modified
  if (isObject(obj) && (!patch.props || Object.keys(patch.props).length === 0) &&
      (!patch.edits || patch.edits.length === 0) && !updated[patch.objectId]) {
    return obj
  }

  if (patch.type === 'map') {
    return updateMapObject(patch, obj, updated)
  } else if (patch.type === 'table') {
    return updateTableObject(patch, obj, updated)
  } else if (patch.type === 'list') {
    return updateListObject(patch, obj, updated)
  } else if (patch.type === 'text') {
    return updateTextObject(patch, obj, updated)
  } else {
    throw new TypeError(`Unknown object type: ${patch.type}`)
  }
}

/**
 * Creates a writable copy of the immutable document root object `root`.
 */
function cloneRootObject(root) {
  if (root[OBJECT_ID] !== '_root') {
    throw new RangeError(`Not the root object: ${root[OBJECT_ID]}`)
  }
  return cloneMapObject(root, '_root')
}

module.exports = {
  interpretPatch, cloneRootObject
}


/***/ }),

/***/ "./frontend/constants.js":
/*!*******************************!*\
  !*** ./frontend/constants.js ***!
  \*******************************/
/***/ (function(module) {

// Properties of the document root object
const OPTIONS   = Symbol('_options')   // object containing options passed to init()
const CACHE     = Symbol('_cache')     // map from objectId to immutable object
const STATE     = Symbol('_state')     // object containing metadata about current state (e.g. sequence numbers)

// Properties of all Automerge objects
const OBJECT_ID = Symbol('_objectId')  // the object ID of the current object (string)
const CONFLICTS = Symbol('_conflicts') // map or list (depending on object type) of conflicts
const CHANGE    = Symbol('_change')    // the context object on proxy objects used in change callback
const ELEM_IDS  = Symbol('_elemIds')   // list containing the element ID of each list element

module.exports = {
  OPTIONS, CACHE, STATE, OBJECT_ID, CONFLICTS, CHANGE, ELEM_IDS
}


/***/ }),

/***/ "./frontend/context.js":
/*!*****************************!*\
  !*** ./frontend/context.js ***!
  \*****************************/
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

const { CACHE, OBJECT_ID, CONFLICTS, ELEM_IDS, STATE } = __webpack_require__(/*! ./constants */ "./frontend/constants.js")
const { interpretPatch } = __webpack_require__(/*! ./apply_patch */ "./frontend/apply_patch.js")
const { Text } = __webpack_require__(/*! ./text */ "./frontend/text.js")
const { Table } = __webpack_require__(/*! ./table */ "./frontend/table.js")
const { Counter, getWriteableCounter } = __webpack_require__(/*! ./counter */ "./frontend/counter.js")
const { Int, Uint, Float64 } = __webpack_require__(/*! ./numbers */ "./frontend/numbers.js")
const { isObject, parseOpId, createArrayOfNulls } = __webpack_require__(/*! ../src/common */ "./src/common.js")
const uuid = __webpack_require__(/*! ../src/uuid */ "./src/uuid.js")


/**
 * An instance of this class is passed to `rootObjectProxy()`. The methods are
 * called by proxy object mutation functions to query the current object state
 * and to apply the requested changes.
 */
class Context {
  constructor (doc, actorId, applyPatch) {
    this.actorId = actorId
    this.maxOp = doc[STATE].maxOp
    this.cache = doc[CACHE]
    this.updated = {}
    this.ops = []
    this.applyPatch = applyPatch ? applyPatch : interpretPatch
  }

  /**
   * Adds an operation object to the list of changes made in the current context.
   */
  addOp(operation) {
    this.ops.push(operation)
  }

  /**
   * Returns the operation ID of the next operation to be added to the context.
   */
  nextOpId() {
    let opNum = this.maxOp + 1
    for (const op of this.ops) {
      if (op.action === 'set' && op.values) {
        opNum += op.values.length
      } else if (op.action === 'del' && op.multiOp) {
        opNum += op.multiOp
      } else {
        opNum += 1
      }
    }
    return `${opNum}@${this.actorId}`
  }

  /**
   * Takes a value and returns an object describing the value (in the format used by patches).
   */
  getValueDescription(value) {
    if (!['object', 'boolean', 'number', 'string'].includes(typeof value)) {
      throw new TypeError(`Unsupported type of value: ${typeof value}`)
    }

    if (isObject(value)) {
      if (value instanceof Date) {
        // Date object, represented as milliseconds since epoch
        return {type: 'value', value: value.getTime(), datatype: 'timestamp'}

      } else if (value instanceof Int) {
        return {type: 'value', value: value.value, datatype: 'int'}
      } else if (value instanceof Uint) {
        return {type: 'value', value: value.value, datatype: 'uint'}
      } else if (value instanceof Float64) {
        return {type: 'value', value: value.value, datatype: 'float64'}
      } else if (value instanceof Counter) {
        // Counter object
        return {type: 'value', value: value.value, datatype: 'counter'}

      } else {
        // Nested object (map, list, text, or table)
        const objectId = value[OBJECT_ID], type = this.getObjectType(objectId)
        if (!objectId) {
          throw new RangeError(`Object ${JSON.stringify(value)} has no objectId`)
        }
        if (type === 'list' || type === 'text') {
          return {objectId, type, edits: []}
        } else {
          return {objectId, type, props: {}}
        }
      }
    } else if (typeof value === 'number') {
      if (Number.isInteger(value) && value <= Number.MAX_SAFE_INTEGER && value >= Number.MIN_SAFE_INTEGER) {
        return {type: 'value', value, datatype: 'int'}
      } else {
        return {type: 'value', value, datatype: 'float64'}
      }
    } else {
      // Primitive value (string, boolean, or null)
      return {type: 'value', value}
    }
  }

  /**
   * Builds the values structure describing a single property in a patch. Finds all the values of
   * property `key` of `object` (there might be multiple values in the case of a conflict), and
   * returns an object that maps operation IDs to descriptions of values.
   */
  getValuesDescriptions(path, object, key) {
    if (object instanceof Table) {
      // Table objects don't have conflicts, since rows are identified by their unique objectId
      const value = object.byId(key)
      return value ? {[key]: this.getValueDescription(value)} : {}
    } else if (object instanceof Text) {
      // Text objects don't support conflicts
      const value = object.get(key)
      const elemId = object.getElemId(key)
      return value ? {[elemId]: this.getValueDescription(value)} : {}
    } else {
      // Map or list objects
      const conflicts = object[CONFLICTS][key], values = {}
      if (!conflicts) {
        throw new RangeError(`No children at key ${key} of path ${JSON.stringify(path)}`)
      }
      for (let opId of Object.keys(conflicts)) {
        values[opId] = this.getValueDescription(conflicts[opId])
      }
      return values
    }
  }

  /**
   * Returns the value at property `key` of object `object`. In the case of a conflict, returns
   * the value whose assignment operation has the ID `opId`.
   */
  getPropertyValue(object, key, opId) {
    if (object instanceof Table) {
      return object.byId(key)
    } else if (object instanceof Text) {
      return object.get(key)
    } else {
      return object[CONFLICTS][key][opId]
    }
  }

  /**
   * Recurses along `path` into the patch object `patch`, creating nodes along the way as needed
   * by mutating the patch object. Returns the subpatch at the given path.
   */
  getSubpatch(patch, path) {
    if (path.length == 0) return patch
    let subpatch = patch, object = this.getObject('_root')

    for (let pathElem of path) {
      let values = this.getValuesDescriptions(path, object, pathElem.key)
      if (subpatch.props) {
        if (!subpatch.props[pathElem.key]) {
          subpatch.props[pathElem.key] = values
        }
      } else if (subpatch.edits) {
        for (const opId of Object.keys(values)) {
          subpatch.edits.push({action: 'update', index: pathElem.key, opId, value: values[opId]})
        }
      }

      let nextOpId = null
      for (let opId of Object.keys(values)) {
        if (values[opId].objectId === pathElem.objectId) {
          nextOpId = opId
        }
      }
      if (!nextOpId) {
        throw new RangeError(`Cannot find path object with objectId ${pathElem.objectId}`)
      }

      subpatch = values[nextOpId]
      object = this.getPropertyValue(object, pathElem.key, nextOpId)
    }

    return subpatch
  }

  /**
   * Returns an object (not proxied) from the cache or updated set, as appropriate.
   */
  getObject(objectId) {
    const object = this.updated[objectId] || this.cache[objectId]
    if (!object) throw new RangeError(`Target object does not exist: ${objectId}`)
    return object
  }

  /**
   * Returns a string that is either 'map', 'table', 'list', or 'text', indicating
   * the type of the object with ID `objectId`.
   */
  getObjectType(objectId) {
    if (objectId === '_root') return 'map'
    const object = this.getObject(objectId)
    if (object instanceof Text) return 'text'
    if (object instanceof Table) return 'table'
    if (Array.isArray(object)) return 'list'
    return 'map'
  }

  /**
   * Returns the value associated with the property named `key` on the object
   * at path `path`. If the value is an object, returns a proxy for it.
   */
  getObjectField(path, objectId, key) {
    if (!['string', 'number'].includes(typeof key)) return
    const object = this.getObject(objectId)

    if (object[key] instanceof Counter) {
      return getWriteableCounter(object[key].value, this, path, objectId, key)

    } else if (isObject(object[key])) {
      const childId = object[key][OBJECT_ID]
      const subpath = path.concat([{key, objectId: childId}])
      // The instantiateObject function is added to the context object by rootObjectProxy()
      return this.instantiateObject(subpath, childId)

    } else {
      return object[key]
    }
  }

  /**
   * Recursively creates Automerge versions of all the objects and nested objects in `value`,
   * constructing a patch and operations that describe the object tree. The new object is
   * assigned to the property `key` in the object with ID `obj`. If the object is a list or
   * text, `key` must be set to the list index being updated, and `elemId` must be set to the
   * elemId of the element being updated. If `insert` is true, we insert a new list element
   * (or text character) at index `key`, and `elemId` must be the elemId of the immediate
   * predecessor element (or the string '_head' if inserting at index 0). If the assignment
   * overwrites a previous value at this key/element, `pred` must be set to the array of the
   * prior operations we are overwriting (empty array if there is no existing value).
   */
  createNestedObjects(obj, key, value, insert, pred, elemId) {
    if (value[OBJECT_ID]) {
      throw new RangeError('Cannot create a reference to an existing document object')
    }
    const objectId = this.nextOpId()

    if (value instanceof Text) {
      // Create a new Text object
      this.addOp(elemId ? {action: 'makeText', obj, elemId, insert, pred}
                        : {action: 'makeText', obj, key, insert, pred})
      const subpatch = {objectId, type: 'text', edits: []}
      this.insertListItems(subpatch, 0, [...value], true)
      return subpatch

    } else if (value instanceof Table) {
      // Create a new Table object
      if (value.count > 0) {
        throw new RangeError('Assigning a non-empty Table object is not supported')
      }
      this.addOp(elemId ? {action: 'makeTable', obj, elemId, insert, pred}
                        : {action: 'makeTable', obj, key, insert, pred})
      return {objectId, type: 'table', props: {}}

    } else if (Array.isArray(value)) {
      // Create a new list object
      this.addOp(elemId ? {action: 'makeList', obj, elemId, insert, pred}
                        : {action: 'makeList', obj, key, insert, pred})
      const subpatch = {objectId, type: 'list', edits: []}
      this.insertListItems(subpatch, 0, value, true)
      return subpatch

    } else {
      // Create a new map object
      this.addOp(elemId ? {action: 'makeMap', obj, elemId, insert, pred}
                        : {action: 'makeMap', obj, key, insert, pred})
      let props = {}
      for (let nested of Object.keys(value).sort()) {
        const opId = this.nextOpId()
        const valuePatch = this.setValue(objectId, nested, value[nested], false, [])
        props[nested] = {[opId]: valuePatch}
      }
      return {objectId, type: 'map', props}
    }
  }

  /**
   * Records an assignment to a particular key in a map, or a particular index in a list.
   * `objectId` is the ID of the object being modified, `key` is the property name or list
   * index being updated, and `value` is the new value being assigned. If `insert` is true,
   * a new list element is inserted at index `key`, and `value` is assigned to that new list
   * element. `pred` is an array of opIds for previous values of the property being assigned,
   * which are overwritten by this operation. If the object being modified is a list or text,
   * `elemId` is the element ID of the list element being updated (if insert=false), or the
   * element ID of the list element immediately preceding the insertion (if insert=true).
   *
   * Returns a patch describing the new value. The return value is of the form
   * `{objectId, type, props}` if `value` is an object, or `{value, datatype}` if it is a
   * primitive value. For string, number, boolean, or null the datatype is omitted.
   */
  setValue(objectId, key, value, insert, pred, elemId) {
    if (!objectId) {
      throw new RangeError('setValue needs an objectId')
    }
    if (key === '') {
      throw new RangeError('The key of a map entry must not be an empty string')
    }

    if (isObject(value) && !(value instanceof Date) && !(value instanceof Counter) && !(value instanceof Int) && !(value instanceof Uint) && !(value instanceof Float64)) {
      // Nested object (map, list, text, or table)
      return this.createNestedObjects(objectId, key, value, insert, pred, elemId)
    } else {
      // Date or counter object, or primitive value (number, string, boolean, or null)
      const description = this.getValueDescription(value)
      const op = {action: 'set', obj: objectId, insert, value: description.value, pred}
      if (elemId) op.elemId = elemId; else op.key = key
      if (description.datatype) op.datatype = description.datatype
      this.addOp(op)
      return description
    }
  }

  /**
   * Constructs a new patch, calls `callback` with the subpatch at the location `path`,
   * and then immediately applies the patch to the document.
   */
  applyAtPath(path, callback) {
    let diff = {objectId: '_root', type: 'map', props: {}}
    callback(this.getSubpatch(diff, path))
    this.applyPatch(diff, this.cache._root, this.updated)
  }

  /**
   * Updates the map object at path `path`, setting the property with name
   * `key` to `value`.
   */
  setMapKey(path, key, value) {
    if (typeof key !== 'string') {
      throw new RangeError(`The key of a map entry must be a string, not ${typeof key}`)
    }

    const objectId = path.length === 0 ? '_root' : path[path.length - 1].objectId
    const object = this.getObject(objectId)
    if (object[key] instanceof Counter) {
      throw new RangeError('Cannot overwrite a Counter object; use .increment() or .decrement() to change its value.')
    }

    // If the assigned field value is the same as the existing value, and
    // the assignment does not resolve a conflict, do nothing
    if (object[key] !== value || Object.keys(object[CONFLICTS][key] || {}).length > 1 || value === undefined) {
      this.applyAtPath(path, subpatch => {
        const pred = getPred(object, key)
        const opId = this.nextOpId()
        const valuePatch = this.setValue(objectId, key, value, false, pred)
        subpatch.props[key] = {[opId]: valuePatch}
      })
    }
  }

  /**
   * Updates the map object at path `path`, deleting the property `key`.
   */
  deleteMapKey(path, key) {
    const objectId = path.length === 0 ? '_root' : path[path.length - 1].objectId
    const object = this.getObject(objectId)

    if (object[key] !== undefined) {
      const pred = getPred(object, key)
      this.addOp({action: 'del', obj: objectId, key, insert: false, pred})
      this.applyAtPath(path, subpatch => {
        subpatch.props[key] = {}
      })
    }
  }

  /**
   * Inserts a sequence of new list elements `values` into a list, starting at position `index`.
   * `newObject` is true if we are creating a new list object, and false if we are updating an
   * existing one. `subpatch` is the patch for the list object being modified. Mutates
   * `subpatch` to reflect the sequence of values.
   */
  insertListItems(subpatch, index, values, newObject) {
    const list = newObject ? [] : this.getObject(subpatch.objectId)
    if (index < 0 || index > list.length) {
      throw new RangeError(`List index ${index} is out of bounds for list of length ${list.length}`)
    }
    if (values.length === 0) return

    let elemId = getElemId(list, index, true)
    const allPrimitive = values.every(v => typeof v === 'string' || typeof v === 'number' ||
                                           typeof v === 'boolean' || v === null ||
                                           (isObject(v) && (v instanceof Date || v instanceof Counter || v instanceof Int ||
                                                            v instanceof Uint || v instanceof Float64)))
    const allValueDescriptions = allPrimitive ? values.map(v => this.getValueDescription(v)) : []
    const allDatatypesSame = allValueDescriptions.every(t => t.datatype === allValueDescriptions[0].datatype)

    if (allPrimitive && allDatatypesSame && values.length > 1) {
      const nextElemId = this.nextOpId()
      const datatype = allValueDescriptions[0].datatype
      const values = allValueDescriptions.map(v => v.value)
      const op = {action: 'set', obj: subpatch.objectId, elemId, insert: true, values, pred: []}
      const edit = {action: 'multi-insert', elemId: nextElemId, index, values}
      if (datatype) {
        op.datatype = datatype
        edit.datatype = datatype
      }
      this.addOp(op)
      subpatch.edits.push(edit)
    } else {
      for (let offset = 0; offset < values.length; offset++) {
        let nextElemId = this.nextOpId()
        const valuePatch = this.setValue(subpatch.objectId, index + offset, values[offset], true, [], elemId)
        elemId = nextElemId
        subpatch.edits.push({action: 'insert', index: index + offset, elemId, opId: elemId, value: valuePatch})
      }
    }
  }

  /**
   * Updates the list object at path `path`, replacing the current value at
   * position `index` with the new value `value`.
   */
  setListIndex(path, index, value) {
    const objectId = path.length === 0 ? '_root' : path[path.length - 1].objectId
    const list = this.getObject(objectId)

    // Assignment past the end of the list => insert nulls followed by new value
    if (index >= list.length) {
      const insertions = createArrayOfNulls(index - list.length)
      insertions.push(value)
      return this.splice(path, list.length, 0, insertions)
    }
    if (list[index] instanceof Counter) {
      throw new RangeError('Cannot overwrite a Counter object; use .increment() or .decrement() to change its value.')
    }

    // If the assigned list element value is the same as the existing value, and
    // the assignment does not resolve a conflict, do nothing
    if (list[index] !== value || Object.keys(list[CONFLICTS][index] || {}).length > 1 || value === undefined) {
      this.applyAtPath(path, subpatch => {
        const pred = getPred(list, index)
        const opId = this.nextOpId()
        const valuePatch = this.setValue(objectId, index, value, false, pred, getElemId(list, index))
        subpatch.edits.push({action: 'update', index, opId, value: valuePatch})
      })
    }
  }

  /**
   * Updates the list object at path `path`, deleting `deletions` list elements starting from
   * list index `start`, and inserting the list of new elements `insertions` at that position.
   */
  splice(path, start, deletions, insertions) {
    const objectId = path.length === 0 ? '_root' : path[path.length - 1].objectId
    let list = this.getObject(objectId)
    if (start < 0 || deletions < 0 || start > list.length - deletions) {
      throw new RangeError(`${deletions} deletions starting at index ${start} are out of bounds for list of length ${list.length}`)
    }
    if (deletions === 0 && insertions.length === 0) return

    let patch = {diffs: {objectId: '_root', type: 'map', props: {}}}
    let subpatch = this.getSubpatch(patch.diffs, path)

    if (deletions > 0) {
      let op, lastElemParsed, lastPredParsed
      for (let i = 0; i < deletions; i++) {
        if (this.getObjectField(path, objectId, start + i) instanceof Counter) {
          // This may seem bizarre, but it's really fiddly to implement deletion of counters from
          // lists, and I doubt anyone ever needs to do this, so I'm just going to throw an
          // exception for now. The reason is: a counter is created by a set operation with counter
          // datatype, and subsequent increment ops are successors to the set operation. Normally, a
          // set operation with successor indicates a value that has been overwritten, so a set
          // operation with successors is normally invisible. Counters are an exception, because the
          // increment operations don't make the set operation invisible. When a counter appears in
          // a map, this is not too bad: if all successors are increments, then the counter remains
          // visible; if one or more successors are deletions, it goes away. However, when deleting
          // a list element, we have the additional challenge that we need to distinguish between a
          // list element that is being deleted by the current change (in which case we need to put
          // a 'remove' action in the patch's edits for that list) and a list element that was
          // already deleted previously (in which case the patch should not reflect the deletion).
          // This can be done, but as I said, it's fiddly. If someone wants to pick this up in the
          // future, hopefully the above description will be enough to get you started. Good luck!
          throw new TypeError('Unsupported operation: deleting a counter from a list')
        }

        // Any sequences of deletions with consecutive elemId and pred values get combined into a
        // single multiOp; any others become individual deletion operations. This optimisation only
        // kicks in if the user deletes a sequence of elements at once (in a single call to splice);
        // it might be nice to also detect such runs of deletions in the case where the user deletes
        // a sequence of list elements one by one.
        const thisElem = getElemId(list, start + i), thisElemParsed = parseOpId(thisElem)
        const thisPred = getPred(list, start + i)
        const thisPredParsed = (thisPred.length === 1) ? parseOpId(thisPred[0]) : undefined

        if (op && lastElemParsed && lastPredParsed && thisPredParsed &&
            lastElemParsed.actorId === thisElemParsed.actorId && lastElemParsed.counter + 1 === thisElemParsed.counter &&
            lastPredParsed.actorId === thisPredParsed.actorId && lastPredParsed.counter + 1 === thisPredParsed.counter) {
          op.multiOp = (op.multiOp || 1) + 1
        } else {
          if (op) this.addOp(op)
          op = {action: 'del', obj: objectId, elemId: thisElem, insert: false, pred: thisPred}
        }
        lastElemParsed = thisElemParsed
        lastPredParsed = thisPredParsed
      }
      this.addOp(op)
      subpatch.edits.push({action: 'remove', index: start, count: deletions})
    }

    if (insertions.length > 0) {
      this.insertListItems(subpatch, start, insertions, false)
    }
    this.applyPatch(patch.diffs, this.cache._root, this.updated)
  }

  /**
   * Updates the table object at path `path`, adding a new entry `row`.
   * Returns the objectId of the new row.
   */
  addTableRow(path, row) {
    if (!isObject(row) || Array.isArray(row)) {
      throw new TypeError('A table row must be an object')
    }
    if (row[OBJECT_ID]) {
      throw new TypeError('Cannot reuse an existing object as table row')
    }
    if (row.id) {
      throw new TypeError('A table row must not have an "id" property; it is generated automatically')
    }

    const id = uuid()
    const valuePatch = this.setValue(path[path.length - 1].objectId, id, row, false, [])
    this.applyAtPath(path, subpatch => {
      subpatch.props[id] = {[valuePatch.objectId]: valuePatch}
    })
    return id
  }

  /**
   * Updates the table object at path `path`, deleting the row with ID `rowId`.
   * `pred` is the opId of the operation that originally created the row.
   */
  deleteTableRow(path, rowId, pred) {
    const objectId = path[path.length - 1].objectId, table = this.getObject(objectId)

    if (table.byId(rowId)) {
      this.addOp({action: 'del', obj: objectId, key: rowId, insert: false, pred: [pred]})
      this.applyAtPath(path, subpatch => {
        subpatch.props[rowId] = {}
      })
    }
  }

  /**
   * Adds the integer `delta` to the value of the counter located at property
   * `key` in the object at path `path`.
   */
  increment(path, key, delta) {
    const objectId = path.length === 0 ? '_root' : path[path.length - 1].objectId
    const object = this.getObject(objectId)
    if (!(object[key] instanceof Counter)) {
      throw new TypeError('Only counter values can be incremented')
    }

    // TODO what if there is a conflicting value on the same key as the counter?
    const type = this.getObjectType(objectId)
    const value = object[key].value + delta
    const opId = this.nextOpId()
    const pred = getPred(object, key)

    if (type === 'list' || type === 'text') {
      const elemId = getElemId(object, key, false)
      this.addOp({action: 'inc', obj: objectId, elemId, value: delta, insert: false, pred})
    } else {
      this.addOp({action: 'inc', obj: objectId, key, value: delta, insert: false, pred})
    }

    this.applyAtPath(path, subpatch => {
      if (type === 'list' || type === 'text') {
        subpatch.edits.push({action: 'update', index: key, opId, value: {value, datatype: 'counter'}})
      } else {
        subpatch.props[key] = {[opId]: {value, datatype: 'counter'}}
      }
    })
  }
}

function getPred(object, key) {
  if (object instanceof Table) {
    return [object.opIds[key]]
  } else if (object instanceof Text) {
    return object.elems[key].pred
  } else if (object[CONFLICTS]) {
    return object[CONFLICTS][key] ? Object.keys(object[CONFLICTS][key]) : []
  } else {
    return []
  }
}

function getElemId(list, index, insert = false) {
  if (insert) {
    if (index === 0) return '_head'
    index -= 1
  }
  if (list[ELEM_IDS]) return list[ELEM_IDS][index]
  if (list.getElemId) return list.getElemId(index)
  throw new RangeError(`Cannot find elemId at list index ${index}`)
}

module.exports = {
  Context
}


/***/ }),

/***/ "./frontend/counter.js":
/*!*****************************!*\
  !*** ./frontend/counter.js ***!
  \*****************************/
/***/ (function(module) {

/**
 * The most basic CRDT: an integer value that can be changed only by
 * incrementing and decrementing. Since addition of integers is commutative,
 * the value trivially converges.
 */
class Counter {
  constructor(value) {
    this.value = value || 0
    Object.freeze(this)
  }

  /**
   * A peculiar JavaScript language feature from its early days: if the object
   * `x` has a `valueOf()` method that returns a number, you can use numerical
   * operators on the object `x` directly, such as `x + 1` or `x < 4`.
   * This method is also called when coercing a value to a string by
   * concatenating it with another string, as in `x + ''`.
   * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/valueOf
   */
  valueOf() {
    return this.value
  }

  /**
   * Returns the counter value as a decimal string. If `x` is a counter object,
   * this method is called e.g. when you do `['value: ', x].join('')` or when
   * you use string interpolation: `value: ${x}`.
   */
  toString() {
    return this.valueOf().toString()
  }

  /**
   * Returns the counter value, so that a JSON serialization of an Automerge
   * document represents the counter simply as an integer.
   */
  toJSON() {
    return this.value
  }
}

/**
 * An instance of this class is used when a counter is accessed within a change
 * callback.
 */
class WriteableCounter extends Counter {
  /**
   * Increases the value of the counter by `delta`. If `delta` is not given,
   * increases the value of the counter by 1.
   */
  increment(delta) {
    delta = typeof delta === 'number' ? delta : 1
    this.context.increment(this.path, this.key, delta)
    this.value += delta
    return this.value
  }

  /**
   * Decreases the value of the counter by `delta`. If `delta` is not given,
   * decreases the value of the counter by 1.
   */
  decrement(delta) {
    return this.increment(typeof delta === 'number' ? -delta : -1)
  }
}

/**
 * Returns an instance of `WriteableCounter` for use in a change callback.
 * `context` is the proxy context that keeps track of the mutations.
 * `objectId` is the ID of the object containing the counter, and `key` is
 * the property name (key in map, or index in list) where the counter is
 * located.
*/
function getWriteableCounter(value, context, path, objectId, key) {
  const instance = Object.create(WriteableCounter.prototype)
  instance.value = value
  instance.context = context
  instance.path = path
  instance.objectId = objectId
  instance.key = key
  return instance
}

module.exports = { Counter, getWriteableCounter }


/***/ }),

/***/ "./frontend/index.js":
/*!***************************!*\
  !*** ./frontend/index.js ***!
  \***************************/
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

const { OPTIONS, CACHE, STATE, OBJECT_ID, CONFLICTS, CHANGE, ELEM_IDS } = __webpack_require__(/*! ./constants */ "./frontend/constants.js")
const { isObject, copyObject } = __webpack_require__(/*! ../src/common */ "./src/common.js")
const uuid = __webpack_require__(/*! ../src/uuid */ "./src/uuid.js")
const { interpretPatch, cloneRootObject } = __webpack_require__(/*! ./apply_patch */ "./frontend/apply_patch.js")
const { rootObjectProxy } = __webpack_require__(/*! ./proxies */ "./frontend/proxies.js")
const { Context } = __webpack_require__(/*! ./context */ "./frontend/context.js")
const { Text } = __webpack_require__(/*! ./text */ "./frontend/text.js")
const { Table } = __webpack_require__(/*! ./table */ "./frontend/table.js")
const { Counter } = __webpack_require__(/*! ./counter */ "./frontend/counter.js")
const { Float64, Int, Uint } = __webpack_require__(/*! ./numbers */ "./frontend/numbers.js")
const { Observable } = __webpack_require__(/*! ./observable */ "./frontend/observable.js")

/**
 * Actor IDs must consist only of hexadecimal digits so that they can be encoded
 * compactly in binary form.
 */
function checkActorId(actorId) {
  if (typeof actorId !== 'string') {
    throw new TypeError(`Unsupported type of actorId: ${typeof actorId}`)
  }
  if (!/^[0-9a-f]+$/.test(actorId)) {
    throw new RangeError('actorId must consist only of lowercase hex digits')
  }
  if (actorId.length % 2 !== 0) {
    throw new RangeError('actorId must consist of an even number of digits')
  }
}

/**
 * Takes a set of objects that have been updated (in `updated`) and an updated state object
 * `state`, and returns a new immutable document root object based on `doc` that reflects
 * those updates.
 */
function updateRootObject(doc, updated, state) {
  let newDoc = updated._root
  if (!newDoc) {
    newDoc = cloneRootObject(doc[CACHE]._root)
    updated._root = newDoc
  }
  Object.defineProperty(newDoc, OPTIONS,  {value: doc[OPTIONS]})
  Object.defineProperty(newDoc, CACHE,    {value: updated})
  Object.defineProperty(newDoc, STATE,    {value: state})

  if (doc[OPTIONS].freeze) {
    for (let objectId of Object.keys(updated)) {
      if (updated[objectId] instanceof Table) {
        updated[objectId]._freeze()
      } else if (updated[objectId] instanceof Text) {
        Object.freeze(updated[objectId].elems)
        Object.freeze(updated[objectId])
      } else {
        Object.freeze(updated[objectId])
        Object.freeze(updated[objectId][CONFLICTS])
      }
    }
  }

  for (let objectId of Object.keys(doc[CACHE])) {
    if (!updated[objectId]) {
      updated[objectId] = doc[CACHE][objectId]
    }
  }

  if (doc[OPTIONS].freeze) {
    Object.freeze(updated)
  }
  return newDoc
}

/**
 * Adds a new change request to the list of pending requests, and returns an
 * updated document root object.
 * The details of the change are taken from the context object `context`.
 * `options` contains properties that may affect how the change is processed; in
 * particular, the `message` property of `options` is an optional human-readable
 * string describing the change.
 */
function makeChange(doc, context, options) {
  const actor = getActorId(doc)
  if (!actor) {
    throw new Error('Actor ID must be initialized with setActorId() before making a change')
  }
  const state = copyObject(doc[STATE])
  state.seq += 1

  const change = {
    actor,
    seq: state.seq,
    startOp: state.maxOp + 1,
    deps: state.deps,
    time: (options && typeof options.time === 'number') ? options.time
                                                        : Math.round(new Date().getTime() / 1000),
    message: (options && typeof options.message === 'string') ? options.message : '',
    ops: context.ops
  }

  if (doc[OPTIONS].backend) {
    const [backendState, patch, binaryChange] = doc[OPTIONS].backend.applyLocalChange(state.backendState, change)
    state.backendState = backendState
    state.lastLocalChange = binaryChange
    // NOTE: When performing a local change, the patch is effectively applied twice -- once by the
    // context invoking interpretPatch as soon as any change is made, and the second time here
    // (after a round-trip through the backend). This is perhaps more robust, as changes only take
    // effect in the form processed by the backend, but the downside is a performance cost.
    // Should we change this?
    const newDoc = applyPatchToDoc(doc, patch, state, true)
    const patchCallback = options && options.patchCallback || doc[OPTIONS].patchCallback
    if (patchCallback) patchCallback(patch, doc, newDoc, true, [binaryChange])
    return [newDoc, change]

  } else {
    const queuedRequest = {actor, seq: change.seq, before: doc}
    state.requests = state.requests.concat([queuedRequest])
    state.maxOp = state.maxOp + countOps(change.ops)
    state.deps = []
    return [updateRootObject(doc, context ? context.updated : {}, state), change]
  }
}

function countOps(ops) {
  let count = 0
  for (const op of ops) {
    if (op.action === 'set' && op.values) {
      count += op.values.length
    } else {
      count += 1
    }
  }
  return count
}

/**
 * Returns the binary encoding of the last change made by the local actor.
 */
function getLastLocalChange(doc) {
  return doc[STATE] && doc[STATE].lastLocalChange ? doc[STATE].lastLocalChange : null
}

/**
 * Applies the changes described in `patch` to the document with root object
 * `doc`. The state object `state` is attached to the new root object.
 * `fromBackend` should be set to `true` if the patch came from the backend,
 * and to `false` if the patch is a transient local (optimistically applied)
 * change from the frontend.
 */
function applyPatchToDoc(doc, patch, state, fromBackend) {
  const actor = getActorId(doc)
  const updated = {}
  interpretPatch(patch.diffs, doc, updated)

  if (fromBackend) {
    if (!patch.clock) throw new RangeError('patch is missing clock field')
    if (patch.clock[actor] && patch.clock[actor] > state.seq) {
      state.seq = patch.clock[actor]
    }
    state.clock = patch.clock
    state.deps  = patch.deps
    state.maxOp = Math.max(state.maxOp, patch.maxOp)
  }
  return updateRootObject(doc, updated, state)
}

/**
 * Creates an empty document object with no changes.
 */
function init(options) {
  if (typeof options === 'string') {
    options = {actorId: options}
  } else if (typeof options === 'undefined') {
    options = {}
  } else if (!isObject(options)) {
    throw new TypeError(`Unsupported value for init() options: ${options}`)
  }

  if (!options.deferActorId) {
    if (options.actorId === undefined) {
      options.actorId = uuid()
    }
    checkActorId(options.actorId)
  }

  if (options.observable) {
    const patchCallback = options.patchCallback, observable = options.observable
    options.patchCallback = (patch, before, after, local, changes) => {
      if (patchCallback) patchCallback(patch, before, after, local, changes)
      observable.patchCallback(patch, before, after, local, changes)
    }
  }

  const root = {}, cache = {_root: root}
  const state = {seq: 0, maxOp: 0, requests: [], clock: {}, deps: []}
  if (options.backend) {
    state.backendState = options.backend.init()
    state.lastLocalChange = null
  }
  Object.defineProperty(root, OBJECT_ID, {value: '_root'})
  Object.defineProperty(root, OPTIONS,   {value: Object.freeze(options)})
  Object.defineProperty(root, CONFLICTS, {value: Object.freeze({})})
  Object.defineProperty(root, CACHE,     {value: Object.freeze(cache)})
  Object.defineProperty(root, STATE,     {value: Object.freeze(state)})
  return Object.freeze(root)
}

/**
 * Returns a new document object initialized with the given state.
 */
function from(initialState, options) {
  return change(init(options), 'Initialization', doc => Object.assign(doc, initialState))
}


/**
 * Changes a document `doc` according to actions taken by the local user.
 * `options` is an object that can contain the following properties:
 *  - `message`: an optional descriptive string that is attached to the change.
 * If `options` is a string, it is treated as `message`.
 *
 * The actual change is made within the callback function `callback`, which is
 * given a mutable version of the document as argument. Returns a two-element
 * array `[doc, request]` where `doc` is the updated document, and `request`
 * is the change request to send to the backend. If nothing was actually
 * changed, returns the original `doc` and a `null` change request.
 */
function change(doc, options, callback) {
  if (doc[OBJECT_ID] !== '_root') {
    throw new TypeError('The first argument to Automerge.change must be the document root')
  }
  if (doc[CHANGE]) {
    throw new TypeError('Calls to Automerge.change cannot be nested')
  }
  if (typeof options === 'function' && callback === undefined) {
    [options, callback] = [callback, options]
  }
  if (typeof options === 'string') {
    options = {message: options}
  }
  if (options !== undefined && !isObject(options)) {
    throw new TypeError('Unsupported type of options')
  }

  const actorId = getActorId(doc)
  if (!actorId) {
    throw new Error('Actor ID must be initialized with setActorId() before making a change')
  }
  const context = new Context(doc, actorId)
  callback(rootObjectProxy(context))

  if (Object.keys(context.updated).length === 0) {
    // If the callback didn't change anything, return the original document object unchanged
    return [doc, null]
  } else {
    return makeChange(doc, context, options)
  }
}

/**
 * Triggers a new change request on the document `doc` without actually
 * modifying its data. `options` is an object as described in the documentation
 * for the `change` function. This function can be useful for acknowledging the
 * receipt of some message (as it's incorported into the `deps` field of the
 * change). Returns a two-element array `[doc, request]` where `doc` is the
 * updated document, and `request` is the change request to send to the backend.
 */
function emptyChange(doc, options) {
  if (doc[OBJECT_ID] !== '_root') {
    throw new TypeError('The first argument to Automerge.emptyChange must be the document root')
  }
  if (typeof options === 'string') {
    options = {message: options}
  }
  if (options !== undefined && !isObject(options)) {
    throw new TypeError('Unsupported type of options')
  }

  const actorId = getActorId(doc)
  if (!actorId) {
    throw new Error('Actor ID must be initialized with setActorId() before making a change')
  }
  return makeChange(doc, new Context(doc, actorId), options)
}

/**
 * Applies `patch` to the document root object `doc`. This patch must come
 * from the backend; it may be the result of a local change or a remote change.
 * If it is the result of a local change, the `seq` field from the change
 * request should be included in the patch, so that we can match them up here.
 */
function applyPatch(doc, patch, backendState = undefined) {
  if (doc[OBJECT_ID] !== '_root') {
    throw new TypeError('The first argument to Frontend.applyPatch must be the document root')
  }
  const state = copyObject(doc[STATE])

  if (doc[OPTIONS].backend) {
    if (!backendState) {
      throw new RangeError('applyPatch must be called with the updated backend state')
    }
    state.backendState = backendState
    return applyPatchToDoc(doc, patch, state, true)
  }

  let baseDoc

  if (state.requests.length > 0) {
    baseDoc = state.requests[0].before
    if (patch.actor === getActorId(doc)) {
      if (state.requests[0].seq !== patch.seq) {
        throw new RangeError(`Mismatched sequence number: patch ${patch.seq} does not match next request ${state.requests[0].seq}`)
      }
      state.requests = state.requests.slice(1)
    } else {
      state.requests = state.requests.slice()
    }
  } else {
    baseDoc = doc
    state.requests = []
  }

  let newDoc = applyPatchToDoc(baseDoc, patch, state, true)
  if (state.requests.length === 0) {
    return newDoc
  } else {
    state.requests[0] = copyObject(state.requests[0])
    state.requests[0].before = newDoc
    return updateRootObject(doc, {}, state)
  }
}

/**
 * Returns the Automerge object ID of the given object.
 */
function getObjectId(object) {
  return object[OBJECT_ID]
}

/**
 * Returns the object with the given Automerge object ID. Note: when called
 * within a change callback, the returned object is read-only (not a mutable
 * proxy object).
 */
function getObjectById(doc, objectId) {
  // It would be nice to return a proxied object in a change callback.
  // However, that requires knowing the path from the root to the current
  // object, which we don't have if we jumped straight to the object by its ID.
  // If we maintained an index from object ID to parent ID we could work out the path.
  if (doc[CHANGE]) {
    throw new TypeError('Cannot use getObjectById in a change callback')
  }
  return doc[CACHE][objectId]
}

/**
 * Returns the Automerge actor ID of the given document.
 */
function getActorId(doc) {
  return doc[STATE].actorId || doc[OPTIONS].actorId
}

/**
 * Sets the Automerge actor ID on the document object `doc`, returning a
 * document object with updated metadata.
 */
function setActorId(doc, actorId) {
  checkActorId(actorId)
  const state = Object.assign({}, doc[STATE], {actorId})
  return updateRootObject(doc, {}, state)
}

/**
 * Fetches the conflicts on the property `key` of `object`, which may be any
 * object in a document. If `object` is a list, then `key` must be a list
 * index; if `object` is a map, then `key` must be a property name.
 */
function getConflicts(object, key) {
  if (object[CONFLICTS] && object[CONFLICTS][key] &&
      Object.keys(object[CONFLICTS][key]).length > 1) {
    return object[CONFLICTS][key]
  }
}

/**
 * Returns the backend state associated with the document `doc` (only used if
 * a backend implementation is passed to `init()`).
 */
function getBackendState(doc, callerName = null, argPos = 'first') {
  if (doc[OBJECT_ID] !== '_root') {
    // Most likely cause of passing an array here is forgetting to deconstruct the return value of
    // Automerge.applyChanges().
    const extraMsg = Array.isArray(doc) ? '. Note: Automerge.applyChanges now returns an array.' : ''
    if (callerName) {
      throw new TypeError(`The ${argPos} argument to Automerge.${callerName} must be the document root${extraMsg}`)
    } else {
      throw new TypeError(`Argument is not an Automerge document root${extraMsg}`)
    }
  }
  return doc[STATE].backendState
}

/**
 * Given an array or text object from an Automerge document, returns an array
 * containing the unique element ID of each list element/character.
 */
function getElementIds(list) {
  if (list instanceof Text) {
    return list.elems.map(elem => elem.elemId)
  } else {
    return list[ELEM_IDS]
  }
}

module.exports = {
  init, from, change, emptyChange, applyPatch,
  getObjectId, getObjectById, getActorId, setActorId, getConflicts, getLastLocalChange,
  getBackendState, getElementIds,
  Text, Table, Counter, Observable, Float64, Int, Uint
}


/***/ }),

/***/ "./frontend/numbers.js":
/*!*****************************!*\
  !*** ./frontend/numbers.js ***!
  \*****************************/
/***/ (function(module) {

// Convience classes to allow users to stricly specify the number type they want

class Int {
  constructor(value) {
    if (!(Number.isInteger(value) && value <= Number.MAX_SAFE_INTEGER && value >= Number.MIN_SAFE_INTEGER)) {
      throw new RangeError(`Value ${value} cannot be a uint`)
    }
    this.value = value
    Object.freeze(this)
  }
}

class Uint {
  constructor(value) {
    if (!(Number.isInteger(value) && value <= Number.MAX_SAFE_INTEGER && value >= 0)) {
      throw new RangeError(`Value ${value} cannot be a uint`)
    }
    this.value = value
    Object.freeze(this)
  }
}

class Float64 {
  constructor(value) {
    if (typeof value !== 'number') {
      throw new RangeError(`Value ${value} cannot be a float64`)
    }
    this.value = value || 0.0
    Object.freeze(this)
  }
}

module.exports = { Int, Uint, Float64 }


/***/ }),

/***/ "./frontend/observable.js":
/*!********************************!*\
  !*** ./frontend/observable.js ***!
  \********************************/
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

const { OBJECT_ID, CONFLICTS } = __webpack_require__(/*! ./constants */ "./frontend/constants.js")

/**
 * Allows an application to register a callback when a particular object in
 * a document changes.
 *
 * NOTE: This API is experimental and may change without warning in minor releases.
 */
class Observable {
  constructor() {
    this.observers = {} // map from objectId to array of observers for that object
  }

  /**
   * Called by an Automerge document when `patch` is applied. `before` is the
   * state of the document before the patch, and `after` is the state after
   * applying it. `local` is true if the update is a result of locally calling
   * `Automerge.change()`, and false otherwise. `changes` is an array of
   * changes that were applied to the document (as Uint8Arrays).
   */
  patchCallback(patch, before, after, local, changes) {
    this._objectUpdate(patch.diffs, before, after, local, changes)
  }

  /**
   * Recursively walks a patch and calls the callbacks for all objects that
   * appear in the patch.
   */
  _objectUpdate(diff, before, after, local, changes) {
    if (!diff.objectId) return
    if (this.observers[diff.objectId]) {
      for (let callback of this.observers[diff.objectId]) {
        callback(diff, before, after, local, changes)
      }
    }

    if (diff.type === 'map' && diff.props) {
      for (const propName of Object.keys(diff.props)) {
        for (const opId of Object.keys(diff.props[propName])) {
          this._objectUpdate(diff.props[propName][opId],
                             before && before[CONFLICTS] && before[CONFLICTS][propName] && before[CONFLICTS][propName][opId],
                             after && after[CONFLICTS] && after[CONFLICTS][propName] && after[CONFLICTS][propName][opId],
                             local, changes)
        }
      }

    } else if (diff.type === 'table' && diff.props) {
      for (const rowId of Object.keys(diff.props)) {
        for (const opId of Object.keys(diff.props[rowId])) {
          this._objectUpdate(diff.props[rowId][opId],
                             before && before.byId(rowId),
                             after && after.byId(rowId),
                             local, changes)
        }
      }

    } else if (diff.type === 'list' && diff.edits) {
      let offset = 0
      for (const edit of diff.edits) {
        if (edit.action === 'insert') {
          offset -= 1
          this._objectUpdate(edit.value, undefined,
                             after && after[CONFLICTS] && after[CONFLICTS][edit.index] && after[CONFLICTS][edit.index][edit.elemId],
                             local, changes)
        } else if (edit.action === 'multi-insert') {
          offset -= edit.values.length
        } else if (edit.action === 'update') {
          this._objectUpdate(edit.value,
                             before && before[CONFLICTS] && before[CONFLICTS][edit.index + offset] &&
                               before[CONFLICTS][edit.index + offset][edit.opId],
                             after && after[CONFLICTS] && after[CONFLICTS][edit.index] && after[CONFLICTS][edit.index][edit.opId],
                             local, changes)
        } else if (edit.action === 'remove') {
          offset += edit.count
        }
      }

    } else if (diff.type === 'text' && diff.edits) {
      let offset = 0
      for (const edit of diff.edits) {
        if (edit.action === 'insert') {
          offset -= 1
          this._objectUpdate(edit.value, undefined, after && after.get(edit.index), local, changes)
        } else if (edit.action === 'multi-insert') {
          offset -= edit.values.length
        } else if (edit.action === 'update') {
          this._objectUpdate(edit.value,
                             before && before.get(edit.index + offset),
                             after && after.get(edit.index),
                             local, changes)
        } else if (edit.action === 'remove') {
          offset += edit.count
        }
      }
    }
  }

  /**
   * Call this to register a callback that will get called whenever a particular
   * object in a document changes. The callback is passed five arguments: the
   * part of the patch describing the update to that object, the old state of
   * the object, the new state of the object, a boolean that is true if the
   * change is the result of calling `Automerge.change()` locally, and the array
   * of binary changes applied to the document.
   */
  observe(object, callback) {
    const objectId = object[OBJECT_ID]
    if (!objectId) throw new TypeError('The observed object must be part of an Automerge document')
    if (!this.observers[objectId]) this.observers[objectId] = []
    this.observers[objectId].push(callback)
  }
}

module.exports = { Observable }


/***/ }),

/***/ "./frontend/proxies.js":
/*!*****************************!*\
  !*** ./frontend/proxies.js ***!
  \*****************************/
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

const { OBJECT_ID, CHANGE, STATE } = __webpack_require__(/*! ./constants */ "./frontend/constants.js")
const { createArrayOfNulls } = __webpack_require__(/*! ../src/common */ "./src/common.js")
const { Text } = __webpack_require__(/*! ./text */ "./frontend/text.js")
const { Table } = __webpack_require__(/*! ./table */ "./frontend/table.js")

function parseListIndex(key) {
  if (typeof key === 'string' && /^[0-9]+$/.test(key)) key = parseInt(key, 10)
  if (typeof key !== 'number') {
    throw new TypeError('A list index must be a number, but you passed ' + JSON.stringify(key))
  }
  if (key < 0 || isNaN(key) || key === Infinity || key === -Infinity) {
    throw new RangeError('A list index must be positive, but you passed ' + key)
  }
  return key
}

function listMethods(context, listId, path) {
  const methods = {
    deleteAt(index, numDelete) {
      context.splice(path, parseListIndex(index), numDelete || 1, [])
      return this
    },

    fill(value, start, end) {
      let list = context.getObject(listId)
      for (let index = parseListIndex(start || 0); index < parseListIndex(end || list.length); index++) {
        context.setListIndex(path, index, value)
      }
      return this
    },

    indexOf(o, start = 0) {
      const id = o[OBJECT_ID]
      if (id) {
        const list = context.getObject(listId)
        for (let index = start; index < list.length; index++) {
          if (list[index][OBJECT_ID] === id) {
            return index
          }
        }
        return -1
      } else {
        return context.getObject(listId).indexOf(o, start)
      }
    },

    insertAt(index, ...values) {
      context.splice(path, parseListIndex(index), 0, values)
      return this
    },

    pop() {
      let list = context.getObject(listId)
      if (list.length == 0) return
      const last = context.getObjectField(path, listId, list.length - 1)
      context.splice(path, list.length - 1, 1, [])
      return last
    },

    push(...values) {
      let list = context.getObject(listId)
      context.splice(path, list.length, 0, values)
      // need to getObject() again because the list object above may be immutable
      return context.getObject(listId).length
    },

    shift() {
      let list = context.getObject(listId)
      if (list.length == 0) return
      const first = context.getObjectField(path, listId, 0)
      context.splice(path, 0, 1, [])
      return first
    },

    splice(start, deleteCount, ...values) {
      let list = context.getObject(listId)
      start = parseListIndex(start)
      if (deleteCount === undefined || deleteCount > list.length - start) {
        deleteCount = list.length - start
      }
      const deleted = []
      for (let n = 0; n < deleteCount; n++) {
        deleted.push(context.getObjectField(path, listId, start + n))
      }
      context.splice(path, start, deleteCount, values)
      return deleted
    },

    unshift(...values) {
      context.splice(path, 0, 0, values)
      return context.getObject(listId).length
    }
  }

  for (let iterator of ['entries', 'keys', 'values']) {
    let list = context.getObject(listId)
    methods[iterator] = () => list[iterator]()
  }

  // Read-only methods that can delegate to the JavaScript built-in implementations
  for (let method of ['concat', 'every', 'filter', 'find', 'findIndex', 'forEach', 'includes',
                      'join', 'lastIndexOf', 'map', 'reduce', 'reduceRight',
                      'slice', 'some', 'toLocaleString', 'toString']) {
    methods[method] = (...args) => {
      const list = context.getObject(listId)
        .map((item, index) => context.getObjectField(path, listId, index))
      return list[method](...args)
    }
  }

  return methods
}

const MapHandler = {
  get (target, key) {
    const { context, objectId, path } = target
    if (key === OBJECT_ID) return objectId
    if (key === CHANGE) return context
    if (key === STATE) return {actorId: context.actorId}
    return context.getObjectField(path, objectId, key)
  },

  set (target, key, value) {
    const { context, path, readonly } = target
    if (Array.isArray(readonly) && readonly.indexOf(key) >= 0) {
      throw new RangeError(`Object property "${key}" cannot be modified`)
    }
    context.setMapKey(path, key, value)
    return true
  },

  deleteProperty (target, key) {
    const { context, path, readonly } = target
    if (Array.isArray(readonly) && readonly.indexOf(key) >= 0) {
      throw new RangeError(`Object property "${key}" cannot be modified`)
    }
    context.deleteMapKey(path, key)
    return true
  },

  has (target, key) {
    const { context, objectId } = target
    return [OBJECT_ID, CHANGE].includes(key) || (key in context.getObject(objectId))
  },

  getOwnPropertyDescriptor (target, key) {
    const { context, objectId } = target
    const object = context.getObject(objectId)
    if (key in object) {
      return {
        configurable: true, enumerable: true,
        value: context.getObjectField(objectId, key)
      }
    }
  },

  ownKeys (target) {
    const { context, objectId } = target
    return Object.keys(context.getObject(objectId))
  }
}

const ListHandler = {
  get (target, key) {
    const [context, objectId, path] = target
    if (key === Symbol.iterator) return context.getObject(objectId)[Symbol.iterator]
    if (key === OBJECT_ID) return objectId
    if (key === CHANGE) return context
    if (key === 'length') return context.getObject(objectId).length
    if (typeof key === 'string' && /^[0-9]+$/.test(key)) {
      return context.getObjectField(path, objectId, parseListIndex(key))
    }
    return listMethods(context, objectId, path)[key]
  },

  set (target, key, value) {
    const [context, objectId, path] = target
    if (key === 'length') {
      if (typeof value !== 'number') {
        throw new RangeError("Invalid array length")
      }
      const length = context.getObject(objectId).length
      if (length > value) {
        context.splice(path, value, length - value, [])
      } else {
        context.splice(path, length, 0, createArrayOfNulls(value - length))
      }
    } else {
      context.setListIndex(path, parseListIndex(key), value)
    }
    return true
  },

  deleteProperty (target, key) {
    const [context, /* objectId */, path] = target
    context.splice(path, parseListIndex(key), 1, [])
    return true
  },

  has (target, key) {
    const [context, objectId, /* path */] = target
    if (typeof key === 'string' && /^[0-9]+$/.test(key)) {
      return parseListIndex(key) < context.getObject(objectId).length
    }
    return ['length', OBJECT_ID, CHANGE].includes(key)
  },

  getOwnPropertyDescriptor (target, key) {
    const [context, objectId, /* path */] = target
    const object = context.getObject(objectId)

    if (key === 'length') return {writable: true, value: object.length}
    if (key === OBJECT_ID) return {configurable: false, enumerable: false, value: objectId}

    if (typeof key === 'string' && /^[0-9]+$/.test(key)) {
      const index = parseListIndex(key)
      if (index < object.length) return {
        configurable: true, enumerable: true,
        value: context.getObjectField(objectId, index)
      }
    }
  },

  ownKeys (target) {
    const [context, objectId, /* path */] = target
    const object = context.getObject(objectId)
    let keys = ['length']
    for (let key of Object.keys(object)) keys.push(key)
    return keys
  }
}

function mapProxy(context, objectId, path, readonly) {
  return new Proxy({context, objectId, path, readonly}, MapHandler)
}

function listProxy(context, objectId, path) {
  return new Proxy([context, objectId, path], ListHandler)
}

/**
 * Instantiates a proxy object for the given `objectId`.
 * This function is added as a method to the context object by rootObjectProxy().
 * When it is called, `this` is the context object.
 * `readonly` is a list of map property names that cannot be modified.
 */
function instantiateProxy(path, objectId, readonly) {
  const object = this.getObject(objectId)
  if (Array.isArray(object)) {
    return listProxy(this, objectId, path)
  } else if (object instanceof Text || object instanceof Table) {
    return object.getWriteable(this, path)
  } else {
    return mapProxy(this, objectId, path, readonly)
  }
}

function rootObjectProxy(context) {
  context.instantiateObject = instantiateProxy
  return mapProxy(context, '_root', [])
}

module.exports = { rootObjectProxy }


/***/ }),

/***/ "./frontend/table.js":
/*!***************************!*\
  !*** ./frontend/table.js ***!
  \***************************/
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

const { OBJECT_ID, CONFLICTS } = __webpack_require__(/*! ./constants */ "./frontend/constants.js")
const { isObject, copyObject } = __webpack_require__(/*! ../src/common */ "./src/common.js")

function compareRows(properties, row1, row2) {
  for (let prop of properties) {
    if (row1[prop] === row2[prop]) continue

    if (typeof row1[prop] === 'number' && typeof row2[prop] === 'number') {
      return row1[prop] - row2[prop]
    } else {
      const prop1 = '' + row1[prop], prop2 = '' + row2[prop]
      if (prop1 === prop2) continue
      if (prop1 < prop2) return -1; else return +1
    }
  }
  return 0
}


/**
 * A relational-style unordered collection of records (rows). Each row is an
 * object that maps column names to values. The set of rows is represented by
 * a map from UUID to row object.
 */
class Table {
  /**
   * This constructor is used by application code when creating a new Table
   * object within a change callback.
   */
  constructor() {
    this.entries = Object.freeze({})
    this.opIds = Object.freeze({})
    Object.freeze(this)
  }

  /**
   * Looks up a row in the table by its unique ID.
   */
  byId(id) {
    return this.entries[id]
  }

  /**
   * Returns an array containing the unique IDs of all rows in the table, in no
   * particular order.
   */
  get ids() {
    return Object.keys(this.entries).filter(key => {
      const entry = this.entries[key]
      return isObject(entry) && entry.id === key
    })
  }

  /**
   * Returns the number of rows in the table.
   */
  get count() {
    return this.ids.length
  }

  /**
   * Returns an array containing all of the rows in the table, in no particular
   * order.
   */
  get rows() {
    return this.ids.map(id => this.byId(id))
  }

  /**
   * The standard JavaScript `filter()` method, which passes each row to the
   * callback function and returns all rows for which the it returns true.
   */
  filter(callback, thisArg) {
    return this.rows.filter(callback, thisArg)
  }

  /**
   * The standard JavaScript `find()` method, which passes each row to the
   * callback function and returns the first row for which it returns true.
   */
  find(callback, thisArg) {
    return this.rows.find(callback, thisArg)
  }

  /**
   * The standard JavaScript `map()` method, which passes each row to the
   * callback function and returns a list of its return values.
   */
  map(callback, thisArg) {
    return this.rows.map(callback, thisArg)
  }

  /**
  * Returns the list of rows, sorted by one of the following:
  * - If a function argument is given, it compares rows as per
  *   https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort#Description
  * - If a string argument is given, it is interpreted as a column name and
  *   rows are sorted according to that column.
  * - If an array of strings is given, it is interpreted as a list of column
  *   names, and rows are sorted lexicographically by those columns.
  * - If no argument is given, it sorts by row ID by default.
  */
  sort(arg) {
    if (typeof arg === 'function') {
      return this.rows.sort(arg)
    } else if (typeof arg === 'string') {
      return this.rows.sort((row1, row2) => compareRows([arg], row1, row2))
    } else if (Array.isArray(arg)) {
      return this.rows.sort((row1, row2) => compareRows(arg, row1, row2))
    } else if (arg === undefined) {
      return this.rows.sort((row1, row2) => compareRows(['id'], row1, row2))
    } else {
      throw new TypeError(`Unsupported sorting argument: ${arg}`)
    }
  }

  /**
   * When iterating over a table, you get all rows in the table, in no
   * particular order.
   */
  [Symbol.iterator] () {
    let rows = this.rows, index = -1
    return {
      next () {
        index += 1
        if (index < rows.length) {
          return {done: false, value: rows[index]}
        } else {
          return {done: true}
        }
      }
    }
  }

  /**
   * Returns a shallow clone of this object. This clone is used while applying
   * a patch to the table, and `freeze()` is called on it when we have finished
   * applying the patch.
   */
  _clone() {
    if (!this[OBJECT_ID]) {
      throw new RangeError('clone() requires the objectId to be set')
    }
    return instantiateTable(this[OBJECT_ID], copyObject(this.entries), copyObject(this.opIds))
  }

  /**
   * Sets the entry with key `id` to `value`. `opId` is the ID of the operation
   * performing this assignment. This method is for internal use only; it is
   * not part of the public API of Automerge.Table.
   */
  _set(id, value, opId) {
    if (Object.isFrozen(this.entries)) {
      throw new Error('A table can only be modified in a change function')
    }
    if (isObject(value) && !Array.isArray(value)) {
      Object.defineProperty(value, 'id', {value: id, enumerable: true})
    }
    this.entries[id] = value
    this.opIds[id] = opId
  }

  /**
   * Removes the row with unique ID `id` from the table.
   */
  remove(id) {
    if (Object.isFrozen(this.entries)) {
      throw new Error('A table can only be modified in a change function')
    }
    delete this.entries[id]
    delete this.opIds[id]
  }

  /**
   * Makes this object immutable. This is called after a change has been made.
   */
  _freeze() {
    Object.freeze(this.entries)
    Object.freeze(this.opIds)
    Object.freeze(this)
  }

  /**
   * Returns a writeable instance of this table. This instance is returned when
   * the table is accessed within a change callback. `context` is the proxy
   * context that keeps track of the mutations.
   */
  getWriteable(context, path) {
    if (!this[OBJECT_ID]) {
      throw new RangeError('getWriteable() requires the objectId to be set')
    }

    const instance = Object.create(WriteableTable.prototype)
    instance[OBJECT_ID] = this[OBJECT_ID]
    instance.context = context
    instance.entries = this.entries
    instance.opIds = this.opIds
    instance.path = path
    return instance
  }

  /**
   * Returns an object containing the table entries, indexed by objectID,
   * for serializing an Automerge document to JSON.
   */
  toJSON() {
    const rows = {}
    for (let id of this.ids) rows[id] = this.byId(id)
    return rows
  }
}

/**
 * An instance of this class is used when a table is accessed within a change
 * callback.
 */
class WriteableTable extends Table {
  /**
   * Returns a proxied version of the row with ID `id`. This row object can be
   * modified within a change callback.
   */
  byId(id) {
    if (isObject(this.entries[id]) && this.entries[id].id === id) {
      const objectId = this.entries[id][OBJECT_ID]
      const path = this.path.concat([{key: id, objectId}])
      return this.context.instantiateObject(path, objectId, ['id'])
    }
  }

  /**
   * Adds a new row to the table. The row is given as a map from
   * column name to value. Returns the objectId of the new row.
   */
  add(row) {
    return this.context.addTableRow(this.path, row)
  }

  /**
   * Removes the row with ID `id` from the table. Throws an exception if the row
   * does not exist in the table.
   */
  remove(id) {
    if (isObject(this.entries[id]) && this.entries[id].id === id) {
      this.context.deleteTableRow(this.path, id, this.opIds[id])
    } else {
      throw new RangeError(`There is no row with ID ${id} in this table`)
    }
  }
}

/**
 * This function is used to instantiate a Table object in the context of
 * applying a patch (see apply_patch.js).
 */
function instantiateTable(objectId, entries, opIds) {
  const instance = Object.create(Table.prototype)
  if (!objectId) {
    throw new RangeError('instantiateTable requires an objectId to be given')
  }
  instance[OBJECT_ID] = objectId
  instance[CONFLICTS] = Object.freeze({})
  instance.entries = entries || {}
  instance.opIds = opIds || {}
  return instance
}

module.exports = { Table, instantiateTable }


/***/ }),

/***/ "./frontend/text.js":
/*!**************************!*\
  !*** ./frontend/text.js ***!
  \**************************/
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

const { OBJECT_ID } = __webpack_require__(/*! ./constants */ "./frontend/constants.js")
const { isObject } = __webpack_require__(/*! ../src/common */ "./src/common.js")

class Text {
  constructor (text) {
    if (typeof text === 'string') {
      const elems = [...text].map(value => ({value}))
      return instantiateText(undefined, elems) // eslint-disable-line
    } else if (Array.isArray(text)) {
      const elems = text.map(value => ({value}))
      return instantiateText(undefined, elems) // eslint-disable-line
    } else if (text === undefined) {
      return instantiateText(undefined, []) // eslint-disable-line
    } else {
      throw new TypeError(`Unsupported initial value for Text: ${text}`)
    }
  }

  get length () {
    return this.elems.length
  }

  get (index) {
    const value = this.elems[index].value
    if (this.context && isObject(value)) {
      const objectId = value[OBJECT_ID]
      const path = this.path.concat([{key: index, objectId}])
      return this.context.instantiateObject(path, objectId)
    } else {
      return value
    }
  }

  getElemId (index) {
    return this.elems[index].elemId
  }

  /**
   * Iterates over the text elements character by character, including any
   * inline objects.
   */
  [Symbol.iterator] () {
    let elems = this.elems, index = -1
    return {
      next () {
        index += 1
        if (index < elems.length) {
          return {done: false, value: elems[index].value}
        } else {
          return {done: true}
        }
      }
    }
  }

  /**
   * Returns the content of the Text object as a simple string, ignoring any
   * non-character elements.
   */
  toString() {
    // Concatting to a string is faster than creating an array and then
    // .join()ing for small (<100KB) arrays.
    // https://jsperf.com/join-vs-loop-w-type-test
    let str = ''
    for (const elem of this.elems) {
      if (typeof elem.value === 'string') str += elem.value
    }
    return str
  }

  /**
   * Returns the content of the Text object as a sequence of strings,
   * interleaved with non-character elements.
   *
   * For example, the value ['a', 'b', {x: 3}, 'c', 'd'] has spans:
   * => ['ab', {x: 3}, 'cd']
   */
  toSpans() {
    let spans = []
    let chars = ''
    for (const elem of this.elems) {
      if (typeof elem.value === 'string') {
        chars += elem.value
      } else {
        if (chars.length > 0) {
          spans.push(chars)
          chars = ''
        }
        spans.push(elem.value)
      }
    }
    if (chars.length > 0) {
      spans.push(chars)
    }
    return spans
  }

  /**
   * Returns the content of the Text object as a simple string, so that the
   * JSON serialization of an Automerge document represents text nicely.
   */
  toJSON() {
    return this.toString()
  }

  /**
   * Returns a writeable instance of this object. This instance is returned when
   * the text object is accessed within a change callback. `context` is the
   * proxy context that keeps track of the mutations.
   */
  getWriteable(context, path) {
    if (!this[OBJECT_ID]) {
      throw new RangeError('getWriteable() requires the objectId to be set')
    }

    const instance = instantiateText(this[OBJECT_ID], this.elems)
    instance.context = context
    instance.path = path
    return instance
  }

  /**
   * Updates the list item at position `index` to a new value `value`.
   */
  set (index, value) {
    if (this.context) {
      this.context.setListIndex(this.path, index, value)
    } else if (!this[OBJECT_ID]) {
      this.elems[index].value = value
    } else {
      throw new TypeError('Automerge.Text object cannot be modified outside of a change block')
    }
    return this
  }

  /**
   * Inserts new list items `values` starting at position `index`.
   */
  insertAt(index, ...values) {
    if (this.context) {
      this.context.splice(this.path, index, 0, values)
    } else if (!this[OBJECT_ID]) {
      this.elems.splice(index, 0, ...values.map(value => ({value})))
    } else {
      throw new TypeError('Automerge.Text object cannot be modified outside of a change block')
    }
    return this
  }

  /**
   * Deletes `numDelete` list items starting at position `index`.
   * if `numDelete` is not given, one item is deleted.
   */
  deleteAt(index, numDelete = 1) {
    if (this.context) {
      this.context.splice(this.path, index, numDelete, [])
    } else if (!this[OBJECT_ID]) {
      this.elems.splice(index, numDelete)
    } else {
      throw new TypeError('Automerge.Text object cannot be modified outside of a change block')
    }
    return this
  }
}

// Read-only methods that can delegate to the JavaScript built-in array
for (let method of ['concat', 'every', 'filter', 'find', 'findIndex', 'forEach', 'includes',
                    'indexOf', 'join', 'lastIndexOf', 'map', 'reduce', 'reduceRight',
                    'slice', 'some', 'toLocaleString']) {
  Text.prototype[method] = function (...args) {
    const array = [...this]
    return array[method](...args)
  }
}

function instantiateText(objectId, elems) {
  const instance = Object.create(Text.prototype)
  instance[OBJECT_ID] = objectId
  instance.elems = elems
  return instance
}

module.exports = { Text, instantiateText }


/***/ }),

/***/ "./node_modules/fast-sha256/sha256.js":
/*!********************************************!*\
  !*** ./node_modules/fast-sha256/sha256.js ***!
  \********************************************/
/***/ (function(module, exports, __webpack_require__) {

var __WEBPACK_AMD_DEFINE_RESULT__;(function (root, factory) {
    // Hack to make all exports of this module sha256 function object properties.
    var exports = {};
    factory(exports);
    var sha256 = exports["default"];
    for (var k in exports) {
        sha256[k] = exports[k];
    }
        
    if ( true && typeof module.exports === 'object') {
        module.exports = sha256;
    } else if (true) {
        !(__WEBPACK_AMD_DEFINE_RESULT__ = (function() { return sha256; }).call(exports, __webpack_require__, exports, module),
		__WEBPACK_AMD_DEFINE_RESULT__ !== undefined && (module.exports = __WEBPACK_AMD_DEFINE_RESULT__)); 
    } else {}
})(this, function(exports) {
"use strict";
exports.__esModule = true;
// SHA-256 (+ HMAC and PBKDF2) for JavaScript.
//
// Written in 2014-2016 by Dmitry Chestnykh.
// Public domain, no warranty.
//
// Functions (accept and return Uint8Arrays):
//
//   sha256(message) -> hash
//   sha256.hmac(key, message) -> mac
//   sha256.pbkdf2(password, salt, rounds, dkLen) -> dk
//
//  Classes:
//
//   new sha256.Hash()
//   new sha256.HMAC(key)
//
exports.digestLength = 32;
exports.blockSize = 64;
// SHA-256 constants
var K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b,
    0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
    0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7,
    0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152,
    0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
    0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
    0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
    0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
    0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);
function hashBlocks(w, v, p, pos, len) {
    var a, b, c, d, e, f, g, h, u, i, j, t1, t2;
    while (len >= 64) {
        a = v[0];
        b = v[1];
        c = v[2];
        d = v[3];
        e = v[4];
        f = v[5];
        g = v[6];
        h = v[7];
        for (i = 0; i < 16; i++) {
            j = pos + i * 4;
            w[i] = (((p[j] & 0xff) << 24) | ((p[j + 1] & 0xff) << 16) |
                ((p[j + 2] & 0xff) << 8) | (p[j + 3] & 0xff));
        }
        for (i = 16; i < 64; i++) {
            u = w[i - 2];
            t1 = (u >>> 17 | u << (32 - 17)) ^ (u >>> 19 | u << (32 - 19)) ^ (u >>> 10);
            u = w[i - 15];
            t2 = (u >>> 7 | u << (32 - 7)) ^ (u >>> 18 | u << (32 - 18)) ^ (u >>> 3);
            w[i] = (t1 + w[i - 7] | 0) + (t2 + w[i - 16] | 0);
        }
        for (i = 0; i < 64; i++) {
            t1 = (((((e >>> 6 | e << (32 - 6)) ^ (e >>> 11 | e << (32 - 11)) ^
                (e >>> 25 | e << (32 - 25))) + ((e & f) ^ (~e & g))) | 0) +
                ((h + ((K[i] + w[i]) | 0)) | 0)) | 0;
            t2 = (((a >>> 2 | a << (32 - 2)) ^ (a >>> 13 | a << (32 - 13)) ^
                (a >>> 22 | a << (32 - 22))) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
            h = g;
            g = f;
            f = e;
            e = (d + t1) | 0;
            d = c;
            c = b;
            b = a;
            a = (t1 + t2) | 0;
        }
        v[0] += a;
        v[1] += b;
        v[2] += c;
        v[3] += d;
        v[4] += e;
        v[5] += f;
        v[6] += g;
        v[7] += h;
        pos += 64;
        len -= 64;
    }
    return pos;
}
// Hash implements SHA256 hash algorithm.
var Hash = /** @class */ (function () {
    function Hash() {
        this.digestLength = exports.digestLength;
        this.blockSize = exports.blockSize;
        // Note: Int32Array is used instead of Uint32Array for performance reasons.
        this.state = new Int32Array(8); // hash state
        this.temp = new Int32Array(64); // temporary state
        this.buffer = new Uint8Array(128); // buffer for data to hash
        this.bufferLength = 0; // number of bytes in buffer
        this.bytesHashed = 0; // number of total bytes hashed
        this.finished = false; // indicates whether the hash was finalized
        this.reset();
    }
    // Resets hash state making it possible
    // to re-use this instance to hash other data.
    Hash.prototype.reset = function () {
        this.state[0] = 0x6a09e667;
        this.state[1] = 0xbb67ae85;
        this.state[2] = 0x3c6ef372;
        this.state[3] = 0xa54ff53a;
        this.state[4] = 0x510e527f;
        this.state[5] = 0x9b05688c;
        this.state[6] = 0x1f83d9ab;
        this.state[7] = 0x5be0cd19;
        this.bufferLength = 0;
        this.bytesHashed = 0;
        this.finished = false;
        return this;
    };
    // Cleans internal buffers and re-initializes hash state.
    Hash.prototype.clean = function () {
        for (var i = 0; i < this.buffer.length; i++) {
            this.buffer[i] = 0;
        }
        for (var i = 0; i < this.temp.length; i++) {
            this.temp[i] = 0;
        }
        this.reset();
    };
    // Updates hash state with the given data.
    //
    // Optionally, length of the data can be specified to hash
    // fewer bytes than data.length.
    //
    // Throws error when trying to update already finalized hash:
    // instance must be reset to use it again.
    Hash.prototype.update = function (data, dataLength) {
        if (dataLength === void 0) { dataLength = data.length; }
        if (this.finished) {
            throw new Error("SHA256: can't update because hash was finished.");
        }
        var dataPos = 0;
        this.bytesHashed += dataLength;
        if (this.bufferLength > 0) {
            while (this.bufferLength < 64 && dataLength > 0) {
                this.buffer[this.bufferLength++] = data[dataPos++];
                dataLength--;
            }
            if (this.bufferLength === 64) {
                hashBlocks(this.temp, this.state, this.buffer, 0, 64);
                this.bufferLength = 0;
            }
        }
        if (dataLength >= 64) {
            dataPos = hashBlocks(this.temp, this.state, data, dataPos, dataLength);
            dataLength %= 64;
        }
        while (dataLength > 0) {
            this.buffer[this.bufferLength++] = data[dataPos++];
            dataLength--;
        }
        return this;
    };
    // Finalizes hash state and puts hash into out.
    //
    // If hash was already finalized, puts the same value.
    Hash.prototype.finish = function (out) {
        if (!this.finished) {
            var bytesHashed = this.bytesHashed;
            var left = this.bufferLength;
            var bitLenHi = (bytesHashed / 0x20000000) | 0;
            var bitLenLo = bytesHashed << 3;
            var padLength = (bytesHashed % 64 < 56) ? 64 : 128;
            this.buffer[left] = 0x80;
            for (var i = left + 1; i < padLength - 8; i++) {
                this.buffer[i] = 0;
            }
            this.buffer[padLength - 8] = (bitLenHi >>> 24) & 0xff;
            this.buffer[padLength - 7] = (bitLenHi >>> 16) & 0xff;
            this.buffer[padLength - 6] = (bitLenHi >>> 8) & 0xff;
            this.buffer[padLength - 5] = (bitLenHi >>> 0) & 0xff;
            this.buffer[padLength - 4] = (bitLenLo >>> 24) & 0xff;
            this.buffer[padLength - 3] = (bitLenLo >>> 16) & 0xff;
            this.buffer[padLength - 2] = (bitLenLo >>> 8) & 0xff;
            this.buffer[padLength - 1] = (bitLenLo >>> 0) & 0xff;
            hashBlocks(this.temp, this.state, this.buffer, 0, padLength);
            this.finished = true;
        }
        for (var i = 0; i < 8; i++) {
            out[i * 4 + 0] = (this.state[i] >>> 24) & 0xff;
            out[i * 4 + 1] = (this.state[i] >>> 16) & 0xff;
            out[i * 4 + 2] = (this.state[i] >>> 8) & 0xff;
            out[i * 4 + 3] = (this.state[i] >>> 0) & 0xff;
        }
        return this;
    };
    // Returns the final hash digest.
    Hash.prototype.digest = function () {
        var out = new Uint8Array(this.digestLength);
        this.finish(out);
        return out;
    };
    // Internal function for use in HMAC for optimization.
    Hash.prototype._saveState = function (out) {
        for (var i = 0; i < this.state.length; i++) {
            out[i] = this.state[i];
        }
    };
    // Internal function for use in HMAC for optimization.
    Hash.prototype._restoreState = function (from, bytesHashed) {
        for (var i = 0; i < this.state.length; i++) {
            this.state[i] = from[i];
        }
        this.bytesHashed = bytesHashed;
        this.finished = false;
        this.bufferLength = 0;
    };
    return Hash;
}());
exports.Hash = Hash;
// HMAC implements HMAC-SHA256 message authentication algorithm.
var HMAC = /** @class */ (function () {
    function HMAC(key) {
        this.inner = new Hash();
        this.outer = new Hash();
        this.blockSize = this.inner.blockSize;
        this.digestLength = this.inner.digestLength;
        var pad = new Uint8Array(this.blockSize);
        if (key.length > this.blockSize) {
            (new Hash()).update(key).finish(pad).clean();
        }
        else {
            for (var i = 0; i < key.length; i++) {
                pad[i] = key[i];
            }
        }
        for (var i = 0; i < pad.length; i++) {
            pad[i] ^= 0x36;
        }
        this.inner.update(pad);
        for (var i = 0; i < pad.length; i++) {
            pad[i] ^= 0x36 ^ 0x5c;
        }
        this.outer.update(pad);
        this.istate = new Uint32Array(8);
        this.ostate = new Uint32Array(8);
        this.inner._saveState(this.istate);
        this.outer._saveState(this.ostate);
        for (var i = 0; i < pad.length; i++) {
            pad[i] = 0;
        }
    }
    // Returns HMAC state to the state initialized with key
    // to make it possible to run HMAC over the other data with the same
    // key without creating a new instance.
    HMAC.prototype.reset = function () {
        this.inner._restoreState(this.istate, this.inner.blockSize);
        this.outer._restoreState(this.ostate, this.outer.blockSize);
        return this;
    };
    // Cleans HMAC state.
    HMAC.prototype.clean = function () {
        for (var i = 0; i < this.istate.length; i++) {
            this.ostate[i] = this.istate[i] = 0;
        }
        this.inner.clean();
        this.outer.clean();
    };
    // Updates state with provided data.
    HMAC.prototype.update = function (data) {
        this.inner.update(data);
        return this;
    };
    // Finalizes HMAC and puts the result in out.
    HMAC.prototype.finish = function (out) {
        if (this.outer.finished) {
            this.outer.finish(out);
        }
        else {
            this.inner.finish(out);
            this.outer.update(out, this.digestLength).finish(out);
        }
        return this;
    };
    // Returns message authentication code.
    HMAC.prototype.digest = function () {
        var out = new Uint8Array(this.digestLength);
        this.finish(out);
        return out;
    };
    return HMAC;
}());
exports.HMAC = HMAC;
// Returns SHA256 hash of data.
function hash(data) {
    var h = (new Hash()).update(data);
    var digest = h.digest();
    h.clean();
    return digest;
}
exports.hash = hash;
// Function hash is both available as module.hash and as default export.
exports["default"] = hash;
// Returns HMAC-SHA256 of data under the key.
function hmac(key, data) {
    var h = (new HMAC(key)).update(data);
    var digest = h.digest();
    h.clean();
    return digest;
}
exports.hmac = hmac;
// Fills hkdf buffer like this:
// T(1) = HMAC-Hash(PRK, T(0) | info | 0x01)
function fillBuffer(buffer, hmac, info, counter) {
    // Counter is a byte value: check if it overflowed.
    var num = counter[0];
    if (num === 0) {
        throw new Error("hkdf: cannot expand more");
    }
    // Prepare HMAC instance for new data with old key.
    hmac.reset();
    // Hash in previous output if it was generated
    // (i.e. counter is greater than 1).
    if (num > 1) {
        hmac.update(buffer);
    }
    // Hash in info if it exists.
    if (info) {
        hmac.update(info);
    }
    // Hash in the counter.
    hmac.update(counter);
    // Output result to buffer and clean HMAC instance.
    hmac.finish(buffer);
    // Increment counter inside typed array, this works properly.
    counter[0]++;
}
var hkdfSalt = new Uint8Array(exports.digestLength); // Filled with zeroes.
function hkdf(key, salt, info, length) {
    if (salt === void 0) { salt = hkdfSalt; }
    if (length === void 0) { length = 32; }
    var counter = new Uint8Array([1]);
    // HKDF-Extract uses salt as HMAC key, and key as data.
    var okm = hmac(salt, key);
    // Initialize HMAC for expanding with extracted key.
    // Ensure no collisions with `hmac` function.
    var hmac_ = new HMAC(okm);
    // Allocate buffer.
    var buffer = new Uint8Array(hmac_.digestLength);
    var bufpos = buffer.length;
    var out = new Uint8Array(length);
    for (var i = 0; i < length; i++) {
        if (bufpos === buffer.length) {
            fillBuffer(buffer, hmac_, info, counter);
            bufpos = 0;
        }
        out[i] = buffer[bufpos++];
    }
    hmac_.clean();
    buffer.fill(0);
    counter.fill(0);
    return out;
}
exports.hkdf = hkdf;
// Derives a key from password and salt using PBKDF2-HMAC-SHA256
// with the given number of iterations.
//
// The number of bytes returned is equal to dkLen.
//
// (For better security, avoid dkLen greater than hash length - 32 bytes).
function pbkdf2(password, salt, iterations, dkLen) {
    var prf = new HMAC(password);
    var len = prf.digestLength;
    var ctr = new Uint8Array(4);
    var t = new Uint8Array(len);
    var u = new Uint8Array(len);
    var dk = new Uint8Array(dkLen);
    for (var i = 0; i * len < dkLen; i++) {
        var c = i + 1;
        ctr[0] = (c >>> 24) & 0xff;
        ctr[1] = (c >>> 16) & 0xff;
        ctr[2] = (c >>> 8) & 0xff;
        ctr[3] = (c >>> 0) & 0xff;
        prf.reset();
        prf.update(salt);
        prf.update(ctr);
        prf.finish(u);
        for (var j = 0; j < len; j++) {
            t[j] = u[j];
        }
        for (var j = 2; j <= iterations; j++) {
            prf.reset();
            prf.update(u).finish(u);
            for (var k = 0; k < len; k++) {
                t[k] ^= u[k];
            }
        }
        for (var j = 0; j < len && i * len + j < dkLen; j++) {
            dk[i * len + j] = t[j];
        }
    }
    for (var i = 0; i < len; i++) {
        t[i] = u[i] = 0;
    }
    for (var i = 0; i < 4; i++) {
        ctr[i] = 0;
    }
    prf.clean();
    return dk;
}
exports.pbkdf2 = pbkdf2;
});


/***/ }),

/***/ "./node_modules/immutable/dist/immutable.js":
/*!**************************************************!*\
  !*** ./node_modules/immutable/dist/immutable.js ***!
  \**************************************************/
/***/ (function(module) {

/**
 * Copyright (c) 2014-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

(function (global, factory) {
   true ? module.exports = factory() :
  0;
}(this, function () { 'use strict';var SLICE$0 = Array.prototype.slice;

  function createClass(ctor, superClass) {
    if (superClass) {
      ctor.prototype = Object.create(superClass.prototype);
    }
    ctor.prototype.constructor = ctor;
  }

  function Iterable(value) {
      return isIterable(value) ? value : Seq(value);
    }


  createClass(KeyedIterable, Iterable);
    function KeyedIterable(value) {
      return isKeyed(value) ? value : KeyedSeq(value);
    }


  createClass(IndexedIterable, Iterable);
    function IndexedIterable(value) {
      return isIndexed(value) ? value : IndexedSeq(value);
    }


  createClass(SetIterable, Iterable);
    function SetIterable(value) {
      return isIterable(value) && !isAssociative(value) ? value : SetSeq(value);
    }



  function isIterable(maybeIterable) {
    return !!(maybeIterable && maybeIterable[IS_ITERABLE_SENTINEL]);
  }

  function isKeyed(maybeKeyed) {
    return !!(maybeKeyed && maybeKeyed[IS_KEYED_SENTINEL]);
  }

  function isIndexed(maybeIndexed) {
    return !!(maybeIndexed && maybeIndexed[IS_INDEXED_SENTINEL]);
  }

  function isAssociative(maybeAssociative) {
    return isKeyed(maybeAssociative) || isIndexed(maybeAssociative);
  }

  function isOrdered(maybeOrdered) {
    return !!(maybeOrdered && maybeOrdered[IS_ORDERED_SENTINEL]);
  }

  Iterable.isIterable = isIterable;
  Iterable.isKeyed = isKeyed;
  Iterable.isIndexed = isIndexed;
  Iterable.isAssociative = isAssociative;
  Iterable.isOrdered = isOrdered;

  Iterable.Keyed = KeyedIterable;
  Iterable.Indexed = IndexedIterable;
  Iterable.Set = SetIterable;


  var IS_ITERABLE_SENTINEL = '@@__IMMUTABLE_ITERABLE__@@';
  var IS_KEYED_SENTINEL = '@@__IMMUTABLE_KEYED__@@';
  var IS_INDEXED_SENTINEL = '@@__IMMUTABLE_INDEXED__@@';
  var IS_ORDERED_SENTINEL = '@@__IMMUTABLE_ORDERED__@@';

  // Used for setting prototype methods that IE8 chokes on.
  var DELETE = 'delete';

  // Constants describing the size of trie nodes.
  var SHIFT = 5; // Resulted in best performance after ______?
  var SIZE = 1 << SHIFT;
  var MASK = SIZE - 1;

  // A consistent shared value representing "not set" which equals nothing other
  // than itself, and nothing that could be provided externally.
  var NOT_SET = {};

  // Boolean references, Rough equivalent of `bool &`.
  var CHANGE_LENGTH = { value: false };
  var DID_ALTER = { value: false };

  function MakeRef(ref) {
    ref.value = false;
    return ref;
  }

  function SetRef(ref) {
    ref && (ref.value = true);
  }

  // A function which returns a value representing an "owner" for transient writes
  // to tries. The return value will only ever equal itself, and will not equal
  // the return of any subsequent call of this function.
  function OwnerID() {}

  // http://jsperf.com/copy-array-inline
  function arrCopy(arr, offset) {
    offset = offset || 0;
    var len = Math.max(0, arr.length - offset);
    var newArr = new Array(len);
    for (var ii = 0; ii < len; ii++) {
      newArr[ii] = arr[ii + offset];
    }
    return newArr;
  }

  function ensureSize(iter) {
    if (iter.size === undefined) {
      iter.size = iter.__iterate(returnTrue);
    }
    return iter.size;
  }

  function wrapIndex(iter, index) {
    // This implements "is array index" which the ECMAString spec defines as:
    //
    //     A String property name P is an array index if and only if
    //     ToString(ToUint32(P)) is equal to P and ToUint32(P) is not equal
    //     to 2^32−1.
    //
    // http://www.ecma-international.org/ecma-262/6.0/#sec-array-exotic-objects
    if (typeof index !== 'number') {
      var uint32Index = index >>> 0; // N >>> 0 is shorthand for ToUint32
      if ('' + uint32Index !== index || uint32Index === 4294967295) {
        return NaN;
      }
      index = uint32Index;
    }
    return index < 0 ? ensureSize(iter) + index : index;
  }

  function returnTrue() {
    return true;
  }

  function wholeSlice(begin, end, size) {
    return (begin === 0 || (size !== undefined && begin <= -size)) &&
      (end === undefined || (size !== undefined && end >= size));
  }

  function resolveBegin(begin, size) {
    return resolveIndex(begin, size, 0);
  }

  function resolveEnd(end, size) {
    return resolveIndex(end, size, size);
  }

  function resolveIndex(index, size, defaultIndex) {
    return index === undefined ?
      defaultIndex :
      index < 0 ?
        Math.max(0, size + index) :
        size === undefined ?
          index :
          Math.min(size, index);
  }

  /* global Symbol */

  var ITERATE_KEYS = 0;
  var ITERATE_VALUES = 1;
  var ITERATE_ENTRIES = 2;

  var REAL_ITERATOR_SYMBOL = typeof Symbol === 'function' && Symbol.iterator;
  var FAUX_ITERATOR_SYMBOL = '@@iterator';

  var ITERATOR_SYMBOL = REAL_ITERATOR_SYMBOL || FAUX_ITERATOR_SYMBOL;


  function Iterator(next) {
      this.next = next;
    }

    Iterator.prototype.toString = function() {
      return '[Iterator]';
    };


  Iterator.KEYS = ITERATE_KEYS;
  Iterator.VALUES = ITERATE_VALUES;
  Iterator.ENTRIES = ITERATE_ENTRIES;

  Iterator.prototype.inspect =
  Iterator.prototype.toSource = function () { return this.toString(); }
  Iterator.prototype[ITERATOR_SYMBOL] = function () {
    return this;
  };


  function iteratorValue(type, k, v, iteratorResult) {
    var value = type === 0 ? k : type === 1 ? v : [k, v];
    iteratorResult ? (iteratorResult.value = value) : (iteratorResult = {
      value: value, done: false
    });
    return iteratorResult;
  }

  function iteratorDone() {
    return { value: undefined, done: true };
  }

  function hasIterator(maybeIterable) {
    return !!getIteratorFn(maybeIterable);
  }

  function isIterator(maybeIterator) {
    return maybeIterator && typeof maybeIterator.next === 'function';
  }

  function getIterator(iterable) {
    var iteratorFn = getIteratorFn(iterable);
    return iteratorFn && iteratorFn.call(iterable);
  }

  function getIteratorFn(iterable) {
    var iteratorFn = iterable && (
      (REAL_ITERATOR_SYMBOL && iterable[REAL_ITERATOR_SYMBOL]) ||
      iterable[FAUX_ITERATOR_SYMBOL]
    );
    if (typeof iteratorFn === 'function') {
      return iteratorFn;
    }
  }

  function isArrayLike(value) {
    return value && typeof value.length === 'number';
  }

  createClass(Seq, Iterable);
    function Seq(value) {
      return value === null || value === undefined ? emptySequence() :
        isIterable(value) ? value.toSeq() : seqFromValue(value);
    }

    Seq.of = function(/*...values*/) {
      return Seq(arguments);
    };

    Seq.prototype.toSeq = function() {
      return this;
    };

    Seq.prototype.toString = function() {
      return this.__toString('Seq {', '}');
    };

    Seq.prototype.cacheResult = function() {
      if (!this._cache && this.__iterateUncached) {
        this._cache = this.entrySeq().toArray();
        this.size = this._cache.length;
      }
      return this;
    };

    // abstract __iterateUncached(fn, reverse)

    Seq.prototype.__iterate = function(fn, reverse) {
      return seqIterate(this, fn, reverse, true);
    };

    // abstract __iteratorUncached(type, reverse)

    Seq.prototype.__iterator = function(type, reverse) {
      return seqIterator(this, type, reverse, true);
    };



  createClass(KeyedSeq, Seq);
    function KeyedSeq(value) {
      return value === null || value === undefined ?
        emptySequence().toKeyedSeq() :
        isIterable(value) ?
          (isKeyed(value) ? value.toSeq() : value.fromEntrySeq()) :
          keyedSeqFromValue(value);
    }

    KeyedSeq.prototype.toKeyedSeq = function() {
      return this;
    };



  createClass(IndexedSeq, Seq);
    function IndexedSeq(value) {
      return value === null || value === undefined ? emptySequence() :
        !isIterable(value) ? indexedSeqFromValue(value) :
        isKeyed(value) ? value.entrySeq() : value.toIndexedSeq();
    }

    IndexedSeq.of = function(/*...values*/) {
      return IndexedSeq(arguments);
    };

    IndexedSeq.prototype.toIndexedSeq = function() {
      return this;
    };

    IndexedSeq.prototype.toString = function() {
      return this.__toString('Seq [', ']');
    };

    IndexedSeq.prototype.__iterate = function(fn, reverse) {
      return seqIterate(this, fn, reverse, false);
    };

    IndexedSeq.prototype.__iterator = function(type, reverse) {
      return seqIterator(this, type, reverse, false);
    };



  createClass(SetSeq, Seq);
    function SetSeq(value) {
      return (
        value === null || value === undefined ? emptySequence() :
        !isIterable(value) ? indexedSeqFromValue(value) :
        isKeyed(value) ? value.entrySeq() : value
      ).toSetSeq();
    }

    SetSeq.of = function(/*...values*/) {
      return SetSeq(arguments);
    };

    SetSeq.prototype.toSetSeq = function() {
      return this;
    };



  Seq.isSeq = isSeq;
  Seq.Keyed = KeyedSeq;
  Seq.Set = SetSeq;
  Seq.Indexed = IndexedSeq;

  var IS_SEQ_SENTINEL = '@@__IMMUTABLE_SEQ__@@';

  Seq.prototype[IS_SEQ_SENTINEL] = true;



  createClass(ArraySeq, IndexedSeq);
    function ArraySeq(array) {
      this._array = array;
      this.size = array.length;
    }

    ArraySeq.prototype.get = function(index, notSetValue) {
      return this.has(index) ? this._array[wrapIndex(this, index)] : notSetValue;
    };

    ArraySeq.prototype.__iterate = function(fn, reverse) {
      var array = this._array;
      var maxIndex = array.length - 1;
      for (var ii = 0; ii <= maxIndex; ii++) {
        if (fn(array[reverse ? maxIndex - ii : ii], ii, this) === false) {
          return ii + 1;
        }
      }
      return ii;
    };

    ArraySeq.prototype.__iterator = function(type, reverse) {
      var array = this._array;
      var maxIndex = array.length - 1;
      var ii = 0;
      return new Iterator(function() 
        {return ii > maxIndex ?
          iteratorDone() :
          iteratorValue(type, ii, array[reverse ? maxIndex - ii++ : ii++])}
      );
    };



  createClass(ObjectSeq, KeyedSeq);
    function ObjectSeq(object) {
      var keys = Object.keys(object);
      this._object = object;
      this._keys = keys;
      this.size = keys.length;
    }

    ObjectSeq.prototype.get = function(key, notSetValue) {
      if (notSetValue !== undefined && !this.has(key)) {
        return notSetValue;
      }
      return this._object[key];
    };

    ObjectSeq.prototype.has = function(key) {
      return this._object.hasOwnProperty(key);
    };

    ObjectSeq.prototype.__iterate = function(fn, reverse) {
      var object = this._object;
      var keys = this._keys;
      var maxIndex = keys.length - 1;
      for (var ii = 0; ii <= maxIndex; ii++) {
        var key = keys[reverse ? maxIndex - ii : ii];
        if (fn(object[key], key, this) === false) {
          return ii + 1;
        }
      }
      return ii;
    };

    ObjectSeq.prototype.__iterator = function(type, reverse) {
      var object = this._object;
      var keys = this._keys;
      var maxIndex = keys.length - 1;
      var ii = 0;
      return new Iterator(function()  {
        var key = keys[reverse ? maxIndex - ii : ii];
        return ii++ > maxIndex ?
          iteratorDone() :
          iteratorValue(type, key, object[key]);
      });
    };

  ObjectSeq.prototype[IS_ORDERED_SENTINEL] = true;


  createClass(IterableSeq, IndexedSeq);
    function IterableSeq(iterable) {
      this._iterable = iterable;
      this.size = iterable.length || iterable.size;
    }

    IterableSeq.prototype.__iterateUncached = function(fn, reverse) {
      if (reverse) {
        return this.cacheResult().__iterate(fn, reverse);
      }
      var iterable = this._iterable;
      var iterator = getIterator(iterable);
      var iterations = 0;
      if (isIterator(iterator)) {
        var step;
        while (!(step = iterator.next()).done) {
          if (fn(step.value, iterations++, this) === false) {
            break;
          }
        }
      }
      return iterations;
    };

    IterableSeq.prototype.__iteratorUncached = function(type, reverse) {
      if (reverse) {
        return this.cacheResult().__iterator(type, reverse);
      }
      var iterable = this._iterable;
      var iterator = getIterator(iterable);
      if (!isIterator(iterator)) {
        return new Iterator(iteratorDone);
      }
      var iterations = 0;
      return new Iterator(function()  {
        var step = iterator.next();
        return step.done ? step : iteratorValue(type, iterations++, step.value);
      });
    };



  createClass(IteratorSeq, IndexedSeq);
    function IteratorSeq(iterator) {
      this._iterator = iterator;
      this._iteratorCache = [];
    }

    IteratorSeq.prototype.__iterateUncached = function(fn, reverse) {
      if (reverse) {
        return this.cacheResult().__iterate(fn, reverse);
      }
      var iterator = this._iterator;
      var cache = this._iteratorCache;
      var iterations = 0;
      while (iterations < cache.length) {
        if (fn(cache[iterations], iterations++, this) === false) {
          return iterations;
        }
      }
      var step;
      while (!(step = iterator.next()).done) {
        var val = step.value;
        cache[iterations] = val;
        if (fn(val, iterations++, this) === false) {
          break;
        }
      }
      return iterations;
    };

    IteratorSeq.prototype.__iteratorUncached = function(type, reverse) {
      if (reverse) {
        return this.cacheResult().__iterator(type, reverse);
      }
      var iterator = this._iterator;
      var cache = this._iteratorCache;
      var iterations = 0;
      return new Iterator(function()  {
        if (iterations >= cache.length) {
          var step = iterator.next();
          if (step.done) {
            return step;
          }
          cache[iterations] = step.value;
        }
        return iteratorValue(type, iterations, cache[iterations++]);
      });
    };




  // # pragma Helper functions

  function isSeq(maybeSeq) {
    return !!(maybeSeq && maybeSeq[IS_SEQ_SENTINEL]);
  }

  var EMPTY_SEQ;

  function emptySequence() {
    return EMPTY_SEQ || (EMPTY_SEQ = new ArraySeq([]));
  }

  function keyedSeqFromValue(value) {
    var seq =
      Array.isArray(value) ? new ArraySeq(value).fromEntrySeq() :
      isIterator(value) ? new IteratorSeq(value).fromEntrySeq() :
      hasIterator(value) ? new IterableSeq(value).fromEntrySeq() :
      typeof value === 'object' ? new ObjectSeq(value) :
      undefined;
    if (!seq) {
      throw new TypeError(
        'Expected Array or iterable object of [k, v] entries, '+
        'or keyed object: ' + value
      );
    }
    return seq;
  }

  function indexedSeqFromValue(value) {
    var seq = maybeIndexedSeqFromValue(value);
    if (!seq) {
      throw new TypeError(
        'Expected Array or iterable object of values: ' + value
      );
    }
    return seq;
  }

  function seqFromValue(value) {
    var seq = maybeIndexedSeqFromValue(value) ||
      (typeof value === 'object' && new ObjectSeq(value));
    if (!seq) {
      throw new TypeError(
        'Expected Array or iterable object of values, or keyed object: ' + value
      );
    }
    return seq;
  }

  function maybeIndexedSeqFromValue(value) {
    return (
      isArrayLike(value) ? new ArraySeq(value) :
      isIterator(value) ? new IteratorSeq(value) :
      hasIterator(value) ? new IterableSeq(value) :
      undefined
    );
  }

  function seqIterate(seq, fn, reverse, useKeys) {
    var cache = seq._cache;
    if (cache) {
      var maxIndex = cache.length - 1;
      for (var ii = 0; ii <= maxIndex; ii++) {
        var entry = cache[reverse ? maxIndex - ii : ii];
        if (fn(entry[1], useKeys ? entry[0] : ii, seq) === false) {
          return ii + 1;
        }
      }
      return ii;
    }
    return seq.__iterateUncached(fn, reverse);
  }

  function seqIterator(seq, type, reverse, useKeys) {
    var cache = seq._cache;
    if (cache) {
      var maxIndex = cache.length - 1;
      var ii = 0;
      return new Iterator(function()  {
        var entry = cache[reverse ? maxIndex - ii : ii];
        return ii++ > maxIndex ?
          iteratorDone() :
          iteratorValue(type, useKeys ? entry[0] : ii - 1, entry[1]);
      });
    }
    return seq.__iteratorUncached(type, reverse);
  }

  function fromJS(json, converter) {
    return converter ?
      fromJSWith(converter, json, '', {'': json}) :
      fromJSDefault(json);
  }

  function fromJSWith(converter, json, key, parentJSON) {
    if (Array.isArray(json)) {
      return converter.call(parentJSON, key, IndexedSeq(json).map(function(v, k)  {return fromJSWith(converter, v, k, json)}));
    }
    if (isPlainObj(json)) {
      return converter.call(parentJSON, key, KeyedSeq(json).map(function(v, k)  {return fromJSWith(converter, v, k, json)}));
    }
    return json;
  }

  function fromJSDefault(json) {
    if (Array.isArray(json)) {
      return IndexedSeq(json).map(fromJSDefault).toList();
    }
    if (isPlainObj(json)) {
      return KeyedSeq(json).map(fromJSDefault).toMap();
    }
    return json;
  }

  function isPlainObj(value) {
    return value && (value.constructor === Object || value.constructor === undefined);
  }

  /**
   * An extension of the "same-value" algorithm as [described for use by ES6 Map
   * and Set](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map#Key_equality)
   *
   * NaN is considered the same as NaN, however -0 and 0 are considered the same
   * value, which is different from the algorithm described by
   * [`Object.is`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/is).
   *
   * This is extended further to allow Objects to describe the values they
   * represent, by way of `valueOf` or `equals` (and `hashCode`).
   *
   * Note: because of this extension, the key equality of Immutable.Map and the
   * value equality of Immutable.Set will differ from ES6 Map and Set.
   *
   * ### Defining custom values
   *
   * The easiest way to describe the value an object represents is by implementing
   * `valueOf`. For example, `Date` represents a value by returning a unix
   * timestamp for `valueOf`:
   *
   *     var date1 = new Date(1234567890000); // Fri Feb 13 2009 ...
   *     var date2 = new Date(1234567890000);
   *     date1.valueOf(); // 1234567890000
   *     assert( date1 !== date2 );
   *     assert( Immutable.is( date1, date2 ) );
   *
   * Note: overriding `valueOf` may have other implications if you use this object
   * where JavaScript expects a primitive, such as implicit string coercion.
   *
   * For more complex types, especially collections, implementing `valueOf` may
   * not be performant. An alternative is to implement `equals` and `hashCode`.
   *
   * `equals` takes another object, presumably of similar type, and returns true
   * if the it is equal. Equality is symmetrical, so the same result should be
   * returned if this and the argument are flipped.
   *
   *     assert( a.equals(b) === b.equals(a) );
   *
   * `hashCode` returns a 32bit integer number representing the object which will
   * be used to determine how to store the value object in a Map or Set. You must
   * provide both or neither methods, one must not exist without the other.
   *
   * Also, an important relationship between these methods must be upheld: if two
   * values are equal, they *must* return the same hashCode. If the values are not
   * equal, they might have the same hashCode; this is called a hash collision,
   * and while undesirable for performance reasons, it is acceptable.
   *
   *     if (a.equals(b)) {
   *       assert( a.hashCode() === b.hashCode() );
   *     }
   *
   * All Immutable collections implement `equals` and `hashCode`.
   *
   */
  function is(valueA, valueB) {
    if (valueA === valueB || (valueA !== valueA && valueB !== valueB)) {
      return true;
    }
    if (!valueA || !valueB) {
      return false;
    }
    if (typeof valueA.valueOf === 'function' &&
        typeof valueB.valueOf === 'function') {
      valueA = valueA.valueOf();
      valueB = valueB.valueOf();
      if (valueA === valueB || (valueA !== valueA && valueB !== valueB)) {
        return true;
      }
      if (!valueA || !valueB) {
        return false;
      }
    }
    if (typeof valueA.equals === 'function' &&
        typeof valueB.equals === 'function' &&
        valueA.equals(valueB)) {
      return true;
    }
    return false;
  }

  function deepEqual(a, b) {
    if (a === b) {
      return true;
    }

    if (
      !isIterable(b) ||
      a.size !== undefined && b.size !== undefined && a.size !== b.size ||
      a.__hash !== undefined && b.__hash !== undefined && a.__hash !== b.__hash ||
      isKeyed(a) !== isKeyed(b) ||
      isIndexed(a) !== isIndexed(b) ||
      isOrdered(a) !== isOrdered(b)
    ) {
      return false;
    }

    if (a.size === 0 && b.size === 0) {
      return true;
    }

    var notAssociative = !isAssociative(a);

    if (isOrdered(a)) {
      var entries = a.entries();
      return b.every(function(v, k)  {
        var entry = entries.next().value;
        return entry && is(entry[1], v) && (notAssociative || is(entry[0], k));
      }) && entries.next().done;
    }

    var flipped = false;

    if (a.size === undefined) {
      if (b.size === undefined) {
        if (typeof a.cacheResult === 'function') {
          a.cacheResult();
        }
      } else {
        flipped = true;
        var _ = a;
        a = b;
        b = _;
      }
    }

    var allEqual = true;
    var bSize = b.__iterate(function(v, k)  {
      if (notAssociative ? !a.has(v) :
          flipped ? !is(v, a.get(k, NOT_SET)) : !is(a.get(k, NOT_SET), v)) {
        allEqual = false;
        return false;
      }
    });

    return allEqual && a.size === bSize;
  }

  createClass(Repeat, IndexedSeq);

    function Repeat(value, times) {
      if (!(this instanceof Repeat)) {
        return new Repeat(value, times);
      }
      this._value = value;
      this.size = times === undefined ? Infinity : Math.max(0, times);
      if (this.size === 0) {
        if (EMPTY_REPEAT) {
          return EMPTY_REPEAT;
        }
        EMPTY_REPEAT = this;
      }
    }

    Repeat.prototype.toString = function() {
      if (this.size === 0) {
        return 'Repeat []';
      }
      return 'Repeat [ ' + this._value + ' ' + this.size + ' times ]';
    };

    Repeat.prototype.get = function(index, notSetValue) {
      return this.has(index) ? this._value : notSetValue;
    };

    Repeat.prototype.includes = function(searchValue) {
      return is(this._value, searchValue);
    };

    Repeat.prototype.slice = function(begin, end) {
      var size = this.size;
      return wholeSlice(begin, end, size) ? this :
        new Repeat(this._value, resolveEnd(end, size) - resolveBegin(begin, size));
    };

    Repeat.prototype.reverse = function() {
      return this;
    };

    Repeat.prototype.indexOf = function(searchValue) {
      if (is(this._value, searchValue)) {
        return 0;
      }
      return -1;
    };

    Repeat.prototype.lastIndexOf = function(searchValue) {
      if (is(this._value, searchValue)) {
        return this.size;
      }
      return -1;
    };

    Repeat.prototype.__iterate = function(fn, reverse) {
      for (var ii = 0; ii < this.size; ii++) {
        if (fn(this._value, ii, this) === false) {
          return ii + 1;
        }
      }
      return ii;
    };

    Repeat.prototype.__iterator = function(type, reverse) {var this$0 = this;
      var ii = 0;
      return new Iterator(function() 
        {return ii < this$0.size ? iteratorValue(type, ii++, this$0._value) : iteratorDone()}
      );
    };

    Repeat.prototype.equals = function(other) {
      return other instanceof Repeat ?
        is(this._value, other._value) :
        deepEqual(other);
    };


  var EMPTY_REPEAT;

  function invariant(condition, error) {
    if (!condition) throw new Error(error);
  }

  createClass(Range, IndexedSeq);

    function Range(start, end, step) {
      if (!(this instanceof Range)) {
        return new Range(start, end, step);
      }
      invariant(step !== 0, 'Cannot step a Range by 0');
      start = start || 0;
      if (end === undefined) {
        end = Infinity;
      }
      step = step === undefined ? 1 : Math.abs(step);
      if (end < start) {
        step = -step;
      }
      this._start = start;
      this._end = end;
      this._step = step;
      this.size = Math.max(0, Math.ceil((end - start) / step - 1) + 1);
      if (this.size === 0) {
        if (EMPTY_RANGE) {
          return EMPTY_RANGE;
        }
        EMPTY_RANGE = this;
      }
    }

    Range.prototype.toString = function() {
      if (this.size === 0) {
        return 'Range []';
      }
      return 'Range [ ' +
        this._start + '...' + this._end +
        (this._step !== 1 ? ' by ' + this._step : '') +
      ' ]';
    };

    Range.prototype.get = function(index, notSetValue) {
      return this.has(index) ?
        this._start + wrapIndex(this, index) * this._step :
        notSetValue;
    };

    Range.prototype.includes = function(searchValue) {
      var possibleIndex = (searchValue - this._start) / this._step;
      return possibleIndex >= 0 &&
        possibleIndex < this.size &&
        possibleIndex === Math.floor(possibleIndex);
    };

    Range.prototype.slice = function(begin, end) {
      if (wholeSlice(begin, end, this.size)) {
        return this;
      }
      begin = resolveBegin(begin, this.size);
      end = resolveEnd(end, this.size);
      if (end <= begin) {
        return new Range(0, 0);
      }
      return new Range(this.get(begin, this._end), this.get(end, this._end), this._step);
    };

    Range.prototype.indexOf = function(searchValue) {
      var offsetValue = searchValue - this._start;
      if (offsetValue % this._step === 0) {
        var index = offsetValue / this._step;
        if (index >= 0 && index < this.size) {
          return index
        }
      }
      return -1;
    };

    Range.prototype.lastIndexOf = function(searchValue) {
      return this.indexOf(searchValue);
    };

    Range.prototype.__iterate = function(fn, reverse) {
      var maxIndex = this.size - 1;
      var step = this._step;
      var value = reverse ? this._start + maxIndex * step : this._start;
      for (var ii = 0; ii <= maxIndex; ii++) {
        if (fn(value, ii, this) === false) {
          return ii + 1;
        }
        value += reverse ? -step : step;
      }
      return ii;
    };

    Range.prototype.__iterator = function(type, reverse) {
      var maxIndex = this.size - 1;
      var step = this._step;
      var value = reverse ? this._start + maxIndex * step : this._start;
      var ii = 0;
      return new Iterator(function()  {
        var v = value;
        value += reverse ? -step : step;
        return ii > maxIndex ? iteratorDone() : iteratorValue(type, ii++, v);
      });
    };

    Range.prototype.equals = function(other) {
      return other instanceof Range ?
        this._start === other._start &&
        this._end === other._end &&
        this._step === other._step :
        deepEqual(this, other);
    };


  var EMPTY_RANGE;

  createClass(Collection, Iterable);
    function Collection() {
      throw TypeError('Abstract');
    }


  createClass(KeyedCollection, Collection);function KeyedCollection() {}

  createClass(IndexedCollection, Collection);function IndexedCollection() {}

  createClass(SetCollection, Collection);function SetCollection() {}


  Collection.Keyed = KeyedCollection;
  Collection.Indexed = IndexedCollection;
  Collection.Set = SetCollection;

  var imul =
    typeof Math.imul === 'function' && Math.imul(0xffffffff, 2) === -2 ?
    Math.imul :
    function imul(a, b) {
      a = a | 0; // int
      b = b | 0; // int
      var c = a & 0xffff;
      var d = b & 0xffff;
      // Shift by 0 fixes the sign on the high part.
      return (c * d) + ((((a >>> 16) * d + c * (b >>> 16)) << 16) >>> 0) | 0; // int
    };

  // v8 has an optimization for storing 31-bit signed numbers.
  // Values which have either 00 or 11 as the high order bits qualify.
  // This function drops the highest order bit in a signed number, maintaining
  // the sign bit.
  function smi(i32) {
    return ((i32 >>> 1) & 0x40000000) | (i32 & 0xBFFFFFFF);
  }

  function hash(o) {
    if (o === false || o === null || o === undefined) {
      return 0;
    }
    if (typeof o.valueOf === 'function') {
      o = o.valueOf();
      if (o === false || o === null || o === undefined) {
        return 0;
      }
    }
    if (o === true) {
      return 1;
    }
    var type = typeof o;
    if (type === 'number') {
      if (o !== o || o === Infinity) {
        return 0;
      }
      var h = o | 0;
      if (h !== o) {
        h ^= o * 0xFFFFFFFF;
      }
      while (o > 0xFFFFFFFF) {
        o /= 0xFFFFFFFF;
        h ^= o;
      }
      return smi(h);
    }
    if (type === 'string') {
      return o.length > STRING_HASH_CACHE_MIN_STRLEN ? cachedHashString(o) : hashString(o);
    }
    if (typeof o.hashCode === 'function') {
      return o.hashCode();
    }
    if (type === 'object') {
      return hashJSObj(o);
    }
    if (typeof o.toString === 'function') {
      return hashString(o.toString());
    }
    throw new Error('Value type ' + type + ' cannot be hashed.');
  }

  function cachedHashString(string) {
    var hash = stringHashCache[string];
    if (hash === undefined) {
      hash = hashString(string);
      if (STRING_HASH_CACHE_SIZE === STRING_HASH_CACHE_MAX_SIZE) {
        STRING_HASH_CACHE_SIZE = 0;
        stringHashCache = {};
      }
      STRING_HASH_CACHE_SIZE++;
      stringHashCache[string] = hash;
    }
    return hash;
  }

  // http://jsperf.com/hashing-strings
  function hashString(string) {
    // This is the hash from JVM
    // The hash code for a string is computed as
    // s[0] * 31 ^ (n - 1) + s[1] * 31 ^ (n - 2) + ... + s[n - 1],
    // where s[i] is the ith character of the string and n is the length of
    // the string. We "mod" the result to make it between 0 (inclusive) and 2^31
    // (exclusive) by dropping high bits.
    var hash = 0;
    for (var ii = 0; ii < string.length; ii++) {
      hash = 31 * hash + string.charCodeAt(ii) | 0;
    }
    return smi(hash);
  }

  function hashJSObj(obj) {
    var hash;
    if (usingWeakMap) {
      hash = weakMap.get(obj);
      if (hash !== undefined) {
        return hash;
      }
    }

    hash = obj[UID_HASH_KEY];
    if (hash !== undefined) {
      return hash;
    }

    if (!canDefineProperty) {
      hash = obj.propertyIsEnumerable && obj.propertyIsEnumerable[UID_HASH_KEY];
      if (hash !== undefined) {
        return hash;
      }

      hash = getIENodeHash(obj);
      if (hash !== undefined) {
        return hash;
      }
    }

    hash = ++objHashUID;
    if (objHashUID & 0x40000000) {
      objHashUID = 0;
    }

    if (usingWeakMap) {
      weakMap.set(obj, hash);
    } else if (isExtensible !== undefined && isExtensible(obj) === false) {
      throw new Error('Non-extensible objects are not allowed as keys.');
    } else if (canDefineProperty) {
      Object.defineProperty(obj, UID_HASH_KEY, {
        'enumerable': false,
        'configurable': false,
        'writable': false,
        'value': hash
      });
    } else if (obj.propertyIsEnumerable !== undefined &&
               obj.propertyIsEnumerable === obj.constructor.prototype.propertyIsEnumerable) {
      // Since we can't define a non-enumerable property on the object
      // we'll hijack one of the less-used non-enumerable properties to
      // save our hash on it. Since this is a function it will not show up in
      // `JSON.stringify` which is what we want.
      obj.propertyIsEnumerable = function() {
        return this.constructor.prototype.propertyIsEnumerable.apply(this, arguments);
      };
      obj.propertyIsEnumerable[UID_HASH_KEY] = hash;
    } else if (obj.nodeType !== undefined) {
      // At this point we couldn't get the IE `uniqueID` to use as a hash
      // and we couldn't use a non-enumerable property to exploit the
      // dontEnum bug so we simply add the `UID_HASH_KEY` on the node
      // itself.
      obj[UID_HASH_KEY] = hash;
    } else {
      throw new Error('Unable to set a non-enumerable property on object.');
    }

    return hash;
  }

  // Get references to ES5 object methods.
  var isExtensible = Object.isExtensible;

  // True if Object.defineProperty works as expected. IE8 fails this test.
  var canDefineProperty = (function() {
    try {
      Object.defineProperty({}, '@', {});
      return true;
    } catch (e) {
      return false;
    }
  }());

  // IE has a `uniqueID` property on DOM nodes. We can construct the hash from it
  // and avoid memory leaks from the IE cloneNode bug.
  function getIENodeHash(node) {
    if (node && node.nodeType > 0) {
      switch (node.nodeType) {
        case 1: // Element
          return node.uniqueID;
        case 9: // Document
          return node.documentElement && node.documentElement.uniqueID;
      }
    }
  }

  // If possible, use a WeakMap.
  var usingWeakMap = typeof WeakMap === 'function';
  var weakMap;
  if (usingWeakMap) {
    weakMap = new WeakMap();
  }

  var objHashUID = 0;

  var UID_HASH_KEY = '__immutablehash__';
  if (typeof Symbol === 'function') {
    UID_HASH_KEY = Symbol(UID_HASH_KEY);
  }

  var STRING_HASH_CACHE_MIN_STRLEN = 16;
  var STRING_HASH_CACHE_MAX_SIZE = 255;
  var STRING_HASH_CACHE_SIZE = 0;
  var stringHashCache = {};

  function assertNotInfinite(size) {
    invariant(
      size !== Infinity,
      'Cannot perform this action with an infinite size.'
    );
  }

  createClass(Map, KeyedCollection);

    // @pragma Construction

    function Map(value) {
      return value === null || value === undefined ? emptyMap() :
        isMap(value) && !isOrdered(value) ? value :
        emptyMap().withMutations(function(map ) {
          var iter = KeyedIterable(value);
          assertNotInfinite(iter.size);
          iter.forEach(function(v, k)  {return map.set(k, v)});
        });
    }

    Map.of = function() {var keyValues = SLICE$0.call(arguments, 0);
      return emptyMap().withMutations(function(map ) {
        for (var i = 0; i < keyValues.length; i += 2) {
          if (i + 1 >= keyValues.length) {
            throw new Error('Missing value for key: ' + keyValues[i]);
          }
          map.set(keyValues[i], keyValues[i + 1]);
        }
      });
    };

    Map.prototype.toString = function() {
      return this.__toString('Map {', '}');
    };

    // @pragma Access

    Map.prototype.get = function(k, notSetValue) {
      return this._root ?
        this._root.get(0, undefined, k, notSetValue) :
        notSetValue;
    };

    // @pragma Modification

    Map.prototype.set = function(k, v) {
      return updateMap(this, k, v);
    };

    Map.prototype.setIn = function(keyPath, v) {
      return this.updateIn(keyPath, NOT_SET, function()  {return v});
    };

    Map.prototype.remove = function(k) {
      return updateMap(this, k, NOT_SET);
    };

    Map.prototype.deleteIn = function(keyPath) {
      return this.updateIn(keyPath, function()  {return NOT_SET});
    };

    Map.prototype.update = function(k, notSetValue, updater) {
      return arguments.length === 1 ?
        k(this) :
        this.updateIn([k], notSetValue, updater);
    };

    Map.prototype.updateIn = function(keyPath, notSetValue, updater) {
      if (!updater) {
        updater = notSetValue;
        notSetValue = undefined;
      }
      var updatedValue = updateInDeepMap(
        this,
        forceIterator(keyPath),
        notSetValue,
        updater
      );
      return updatedValue === NOT_SET ? undefined : updatedValue;
    };

    Map.prototype.clear = function() {
      if (this.size === 0) {
        return this;
      }
      if (this.__ownerID) {
        this.size = 0;
        this._root = null;
        this.__hash = undefined;
        this.__altered = true;
        return this;
      }
      return emptyMap();
    };

    // @pragma Composition

    Map.prototype.merge = function(/*...iters*/) {
      return mergeIntoMapWith(this, undefined, arguments);
    };

    Map.prototype.mergeWith = function(merger) {var iters = SLICE$0.call(arguments, 1);
      return mergeIntoMapWith(this, merger, iters);
    };

    Map.prototype.mergeIn = function(keyPath) {var iters = SLICE$0.call(arguments, 1);
      return this.updateIn(
        keyPath,
        emptyMap(),
        function(m ) {return typeof m.merge === 'function' ?
          m.merge.apply(m, iters) :
          iters[iters.length - 1]}
      );
    };

    Map.prototype.mergeDeep = function(/*...iters*/) {
      return mergeIntoMapWith(this, deepMerger, arguments);
    };

    Map.prototype.mergeDeepWith = function(merger) {var iters = SLICE$0.call(arguments, 1);
      return mergeIntoMapWith(this, deepMergerWith(merger), iters);
    };

    Map.prototype.mergeDeepIn = function(keyPath) {var iters = SLICE$0.call(arguments, 1);
      return this.updateIn(
        keyPath,
        emptyMap(),
        function(m ) {return typeof m.mergeDeep === 'function' ?
          m.mergeDeep.apply(m, iters) :
          iters[iters.length - 1]}
      );
    };

    Map.prototype.sort = function(comparator) {
      // Late binding
      return OrderedMap(sortFactory(this, comparator));
    };

    Map.prototype.sortBy = function(mapper, comparator) {
      // Late binding
      return OrderedMap(sortFactory(this, comparator, mapper));
    };

    // @pragma Mutability

    Map.prototype.withMutations = function(fn) {
      var mutable = this.asMutable();
      fn(mutable);
      return mutable.wasAltered() ? mutable.__ensureOwner(this.__ownerID) : this;
    };

    Map.prototype.asMutable = function() {
      return this.__ownerID ? this : this.__ensureOwner(new OwnerID());
    };

    Map.prototype.asImmutable = function() {
      return this.__ensureOwner();
    };

    Map.prototype.wasAltered = function() {
      return this.__altered;
    };

    Map.prototype.__iterator = function(type, reverse) {
      return new MapIterator(this, type, reverse);
    };

    Map.prototype.__iterate = function(fn, reverse) {var this$0 = this;
      var iterations = 0;
      this._root && this._root.iterate(function(entry ) {
        iterations++;
        return fn(entry[1], entry[0], this$0);
      }, reverse);
      return iterations;
    };

    Map.prototype.__ensureOwner = function(ownerID) {
      if (ownerID === this.__ownerID) {
        return this;
      }
      if (!ownerID) {
        this.__ownerID = ownerID;
        this.__altered = false;
        return this;
      }
      return makeMap(this.size, this._root, ownerID, this.__hash);
    };


  function isMap(maybeMap) {
    return !!(maybeMap && maybeMap[IS_MAP_SENTINEL]);
  }

  Map.isMap = isMap;

  var IS_MAP_SENTINEL = '@@__IMMUTABLE_MAP__@@';

  var MapPrototype = Map.prototype;
  MapPrototype[IS_MAP_SENTINEL] = true;
  MapPrototype[DELETE] = MapPrototype.remove;
  MapPrototype.removeIn = MapPrototype.deleteIn;


  // #pragma Trie Nodes



    function ArrayMapNode(ownerID, entries) {
      this.ownerID = ownerID;
      this.entries = entries;
    }

    ArrayMapNode.prototype.get = function(shift, keyHash, key, notSetValue) {
      var entries = this.entries;
      for (var ii = 0, len = entries.length; ii < len; ii++) {
        if (is(key, entries[ii][0])) {
          return entries[ii][1];
        }
      }
      return notSetValue;
    };

    ArrayMapNode.prototype.update = function(ownerID, shift, keyHash, key, value, didChangeSize, didAlter) {
      var removed = value === NOT_SET;

      var entries = this.entries;
      var idx = 0;
      for (var len = entries.length; idx < len; idx++) {
        if (is(key, entries[idx][0])) {
          break;
        }
      }
      var exists = idx < len;

      if (exists ? entries[idx][1] === value : removed) {
        return this;
      }

      SetRef(didAlter);
      (removed || !exists) && SetRef(didChangeSize);

      if (removed && entries.length === 1) {
        return; // undefined
      }

      if (!exists && !removed && entries.length >= MAX_ARRAY_MAP_SIZE) {
        return createNodes(ownerID, entries, key, value);
      }

      var isEditable = ownerID && ownerID === this.ownerID;
      var newEntries = isEditable ? entries : arrCopy(entries);

      if (exists) {
        if (removed) {
          idx === len - 1 ? newEntries.pop() : (newEntries[idx] = newEntries.pop());
        } else {
          newEntries[idx] = [key, value];
        }
      } else {
        newEntries.push([key, value]);
      }

      if (isEditable) {
        this.entries = newEntries;
        return this;
      }

      return new ArrayMapNode(ownerID, newEntries);
    };




    function BitmapIndexedNode(ownerID, bitmap, nodes) {
      this.ownerID = ownerID;
      this.bitmap = bitmap;
      this.nodes = nodes;
    }

    BitmapIndexedNode.prototype.get = function(shift, keyHash, key, notSetValue) {
      if (keyHash === undefined) {
        keyHash = hash(key);
      }
      var bit = (1 << ((shift === 0 ? keyHash : keyHash >>> shift) & MASK));
      var bitmap = this.bitmap;
      return (bitmap & bit) === 0 ? notSetValue :
        this.nodes[popCount(bitmap & (bit - 1))].get(shift + SHIFT, keyHash, key, notSetValue);
    };

    BitmapIndexedNode.prototype.update = function(ownerID, shift, keyHash, key, value, didChangeSize, didAlter) {
      if (keyHash === undefined) {
        keyHash = hash(key);
      }
      var keyHashFrag = (shift === 0 ? keyHash : keyHash >>> shift) & MASK;
      var bit = 1 << keyHashFrag;
      var bitmap = this.bitmap;
      var exists = (bitmap & bit) !== 0;

      if (!exists && value === NOT_SET) {
        return this;
      }

      var idx = popCount(bitmap & (bit - 1));
      var nodes = this.nodes;
      var node = exists ? nodes[idx] : undefined;
      var newNode = updateNode(node, ownerID, shift + SHIFT, keyHash, key, value, didChangeSize, didAlter);

      if (newNode === node) {
        return this;
      }

      if (!exists && newNode && nodes.length >= MAX_BITMAP_INDEXED_SIZE) {
        return expandNodes(ownerID, nodes, bitmap, keyHashFrag, newNode);
      }

      if (exists && !newNode && nodes.length === 2 && isLeafNode(nodes[idx ^ 1])) {
        return nodes[idx ^ 1];
      }

      if (exists && newNode && nodes.length === 1 && isLeafNode(newNode)) {
        return newNode;
      }

      var isEditable = ownerID && ownerID === this.ownerID;
      var newBitmap = exists ? newNode ? bitmap : bitmap ^ bit : bitmap | bit;
      var newNodes = exists ? newNode ?
        setIn(nodes, idx, newNode, isEditable) :
        spliceOut(nodes, idx, isEditable) :
        spliceIn(nodes, idx, newNode, isEditable);

      if (isEditable) {
        this.bitmap = newBitmap;
        this.nodes = newNodes;
        return this;
      }

      return new BitmapIndexedNode(ownerID, newBitmap, newNodes);
    };




    function HashArrayMapNode(ownerID, count, nodes) {
      this.ownerID = ownerID;
      this.count = count;
      this.nodes = nodes;
    }

    HashArrayMapNode.prototype.get = function(shift, keyHash, key, notSetValue) {
      if (keyHash === undefined) {
        keyHash = hash(key);
      }
      var idx = (shift === 0 ? keyHash : keyHash >>> shift) & MASK;
      var node = this.nodes[idx];
      return node ? node.get(shift + SHIFT, keyHash, key, notSetValue) : notSetValue;
    };

    HashArrayMapNode.prototype.update = function(ownerID, shift, keyHash, key, value, didChangeSize, didAlter) {
      if (keyHash === undefined) {
        keyHash = hash(key);
      }
      var idx = (shift === 0 ? keyHash : keyHash >>> shift) & MASK;
      var removed = value === NOT_SET;
      var nodes = this.nodes;
      var node = nodes[idx];

      if (removed && !node) {
        return this;
      }

      var newNode = updateNode(node, ownerID, shift + SHIFT, keyHash, key, value, didChangeSize, didAlter);
      if (newNode === node) {
        return this;
      }

      var newCount = this.count;
      if (!node) {
        newCount++;
      } else if (!newNode) {
        newCount--;
        if (newCount < MIN_HASH_ARRAY_MAP_SIZE) {
          return packNodes(ownerID, nodes, newCount, idx);
        }
      }

      var isEditable = ownerID && ownerID === this.ownerID;
      var newNodes = setIn(nodes, idx, newNode, isEditable);

      if (isEditable) {
        this.count = newCount;
        this.nodes = newNodes;
        return this;
      }

      return new HashArrayMapNode(ownerID, newCount, newNodes);
    };




    function HashCollisionNode(ownerID, keyHash, entries) {
      this.ownerID = ownerID;
      this.keyHash = keyHash;
      this.entries = entries;
    }

    HashCollisionNode.prototype.get = function(shift, keyHash, key, notSetValue) {
      var entries = this.entries;
      for (var ii = 0, len = entries.length; ii < len; ii++) {
        if (is(key, entries[ii][0])) {
          return entries[ii][1];
        }
      }
      return notSetValue;
    };

    HashCollisionNode.prototype.update = function(ownerID, shift, keyHash, key, value, didChangeSize, didAlter) {
      if (keyHash === undefined) {
        keyHash = hash(key);
      }

      var removed = value === NOT_SET;

      if (keyHash !== this.keyHash) {
        if (removed) {
          return this;
        }
        SetRef(didAlter);
        SetRef(didChangeSize);
        return mergeIntoNode(this, ownerID, shift, keyHash, [key, value]);
      }

      var entries = this.entries;
      var idx = 0;
      for (var len = entries.length; idx < len; idx++) {
        if (is(key, entries[idx][0])) {
          break;
        }
      }
      var exists = idx < len;

      if (exists ? entries[idx][1] === value : removed) {
        return this;
      }

      SetRef(didAlter);
      (removed || !exists) && SetRef(didChangeSize);

      if (removed && len === 2) {
        return new ValueNode(ownerID, this.keyHash, entries[idx ^ 1]);
      }

      var isEditable = ownerID && ownerID === this.ownerID;
      var newEntries = isEditable ? entries : arrCopy(entries);

      if (exists) {
        if (removed) {
          idx === len - 1 ? newEntries.pop() : (newEntries[idx] = newEntries.pop());
        } else {
          newEntries[idx] = [key, value];
        }
      } else {
        newEntries.push([key, value]);
      }

      if (isEditable) {
        this.entries = newEntries;
        return this;
      }

      return new HashCollisionNode(ownerID, this.keyHash, newEntries);
    };




    function ValueNode(ownerID, keyHash, entry) {
      this.ownerID = ownerID;
      this.keyHash = keyHash;
      this.entry = entry;
    }

    ValueNode.prototype.get = function(shift, keyHash, key, notSetValue) {
      return is(key, this.entry[0]) ? this.entry[1] : notSetValue;
    };

    ValueNode.prototype.update = function(ownerID, shift, keyHash, key, value, didChangeSize, didAlter) {
      var removed = value === NOT_SET;
      var keyMatch = is(key, this.entry[0]);
      if (keyMatch ? value === this.entry[1] : removed) {
        return this;
      }

      SetRef(didAlter);

      if (removed) {
        SetRef(didChangeSize);
        return; // undefined
      }

      if (keyMatch) {
        if (ownerID && ownerID === this.ownerID) {
          this.entry[1] = value;
          return this;
        }
        return new ValueNode(ownerID, this.keyHash, [key, value]);
      }

      SetRef(didChangeSize);
      return mergeIntoNode(this, ownerID, shift, hash(key), [key, value]);
    };



  // #pragma Iterators

  ArrayMapNode.prototype.iterate =
  HashCollisionNode.prototype.iterate = function (fn, reverse) {
    var entries = this.entries;
    for (var ii = 0, maxIndex = entries.length - 1; ii <= maxIndex; ii++) {
      if (fn(entries[reverse ? maxIndex - ii : ii]) === false) {
        return false;
      }
    }
  }

  BitmapIndexedNode.prototype.iterate =
  HashArrayMapNode.prototype.iterate = function (fn, reverse) {
    var nodes = this.nodes;
    for (var ii = 0, maxIndex = nodes.length - 1; ii <= maxIndex; ii++) {
      var node = nodes[reverse ? maxIndex - ii : ii];
      if (node && node.iterate(fn, reverse) === false) {
        return false;
      }
    }
  }

  ValueNode.prototype.iterate = function (fn, reverse) {
    return fn(this.entry);
  }

  createClass(MapIterator, Iterator);

    function MapIterator(map, type, reverse) {
      this._type = type;
      this._reverse = reverse;
      this._stack = map._root && mapIteratorFrame(map._root);
    }

    MapIterator.prototype.next = function() {
      var type = this._type;
      var stack = this._stack;
      while (stack) {
        var node = stack.node;
        var index = stack.index++;
        var maxIndex;
        if (node.entry) {
          if (index === 0) {
            return mapIteratorValue(type, node.entry);
          }
        } else if (node.entries) {
          maxIndex = node.entries.length - 1;
          if (index <= maxIndex) {
            return mapIteratorValue(type, node.entries[this._reverse ? maxIndex - index : index]);
          }
        } else {
          maxIndex = node.nodes.length - 1;
          if (index <= maxIndex) {
            var subNode = node.nodes[this._reverse ? maxIndex - index : index];
            if (subNode) {
              if (subNode.entry) {
                return mapIteratorValue(type, subNode.entry);
              }
              stack = this._stack = mapIteratorFrame(subNode, stack);
            }
            continue;
          }
        }
        stack = this._stack = this._stack.__prev;
      }
      return iteratorDone();
    };


  function mapIteratorValue(type, entry) {
    return iteratorValue(type, entry[0], entry[1]);
  }

  function mapIteratorFrame(node, prev) {
    return {
      node: node,
      index: 0,
      __prev: prev
    };
  }

  function makeMap(size, root, ownerID, hash) {
    var map = Object.create(MapPrototype);
    map.size = size;
    map._root = root;
    map.__ownerID = ownerID;
    map.__hash = hash;
    map.__altered = false;
    return map;
  }

  var EMPTY_MAP;
  function emptyMap() {
    return EMPTY_MAP || (EMPTY_MAP = makeMap(0));
  }

  function updateMap(map, k, v) {
    var newRoot;
    var newSize;
    if (!map._root) {
      if (v === NOT_SET) {
        return map;
      }
      newSize = 1;
      newRoot = new ArrayMapNode(map.__ownerID, [[k, v]]);
    } else {
      var didChangeSize = MakeRef(CHANGE_LENGTH);
      var didAlter = MakeRef(DID_ALTER);
      newRoot = updateNode(map._root, map.__ownerID, 0, undefined, k, v, didChangeSize, didAlter);
      if (!didAlter.value) {
        return map;
      }
      newSize = map.size + (didChangeSize.value ? v === NOT_SET ? -1 : 1 : 0);
    }
    if (map.__ownerID) {
      map.size = newSize;
      map._root = newRoot;
      map.__hash = undefined;
      map.__altered = true;
      return map;
    }
    return newRoot ? makeMap(newSize, newRoot) : emptyMap();
  }

  function updateNode(node, ownerID, shift, keyHash, key, value, didChangeSize, didAlter) {
    if (!node) {
      if (value === NOT_SET) {
        return node;
      }
      SetRef(didAlter);
      SetRef(didChangeSize);
      return new ValueNode(ownerID, keyHash, [key, value]);
    }
    return node.update(ownerID, shift, keyHash, key, value, didChangeSize, didAlter);
  }

  function isLeafNode(node) {
    return node.constructor === ValueNode || node.constructor === HashCollisionNode;
  }

  function mergeIntoNode(node, ownerID, shift, keyHash, entry) {
    if (node.keyHash === keyHash) {
      return new HashCollisionNode(ownerID, keyHash, [node.entry, entry]);
    }

    var idx1 = (shift === 0 ? node.keyHash : node.keyHash >>> shift) & MASK;
    var idx2 = (shift === 0 ? keyHash : keyHash >>> shift) & MASK;

    var newNode;
    var nodes = idx1 === idx2 ?
      [mergeIntoNode(node, ownerID, shift + SHIFT, keyHash, entry)] :
      ((newNode = new ValueNode(ownerID, keyHash, entry)), idx1 < idx2 ? [node, newNode] : [newNode, node]);

    return new BitmapIndexedNode(ownerID, (1 << idx1) | (1 << idx2), nodes);
  }

  function createNodes(ownerID, entries, key, value) {
    if (!ownerID) {
      ownerID = new OwnerID();
    }
    var node = new ValueNode(ownerID, hash(key), [key, value]);
    for (var ii = 0; ii < entries.length; ii++) {
      var entry = entries[ii];
      node = node.update(ownerID, 0, undefined, entry[0], entry[1]);
    }
    return node;
  }

  function packNodes(ownerID, nodes, count, excluding) {
    var bitmap = 0;
    var packedII = 0;
    var packedNodes = new Array(count);
    for (var ii = 0, bit = 1, len = nodes.length; ii < len; ii++, bit <<= 1) {
      var node = nodes[ii];
      if (node !== undefined && ii !== excluding) {
        bitmap |= bit;
        packedNodes[packedII++] = node;
      }
    }
    return new BitmapIndexedNode(ownerID, bitmap, packedNodes);
  }

  function expandNodes(ownerID, nodes, bitmap, including, node) {
    var count = 0;
    var expandedNodes = new Array(SIZE);
    for (var ii = 0; bitmap !== 0; ii++, bitmap >>>= 1) {
      expandedNodes[ii] = bitmap & 1 ? nodes[count++] : undefined;
    }
    expandedNodes[including] = node;
    return new HashArrayMapNode(ownerID, count + 1, expandedNodes);
  }

  function mergeIntoMapWith(map, merger, iterables) {
    var iters = [];
    for (var ii = 0; ii < iterables.length; ii++) {
      var value = iterables[ii];
      var iter = KeyedIterable(value);
      if (!isIterable(value)) {
        iter = iter.map(function(v ) {return fromJS(v)});
      }
      iters.push(iter);
    }
    return mergeIntoCollectionWith(map, merger, iters);
  }

  function deepMerger(existing, value, key) {
    return existing && existing.mergeDeep && isIterable(value) ?
      existing.mergeDeep(value) :
      is(existing, value) ? existing : value;
  }

  function deepMergerWith(merger) {
    return function(existing, value, key)  {
      if (existing && existing.mergeDeepWith && isIterable(value)) {
        return existing.mergeDeepWith(merger, value);
      }
      var nextValue = merger(existing, value, key);
      return is(existing, nextValue) ? existing : nextValue;
    };
  }

  function mergeIntoCollectionWith(collection, merger, iters) {
    iters = iters.filter(function(x ) {return x.size !== 0});
    if (iters.length === 0) {
      return collection;
    }
    if (collection.size === 0 && !collection.__ownerID && iters.length === 1) {
      return collection.constructor(iters[0]);
    }
    return collection.withMutations(function(collection ) {
      var mergeIntoMap = merger ?
        function(value, key)  {
          collection.update(key, NOT_SET, function(existing )
            {return existing === NOT_SET ? value : merger(existing, value, key)}
          );
        } :
        function(value, key)  {
          collection.set(key, value);
        }
      for (var ii = 0; ii < iters.length; ii++) {
        iters[ii].forEach(mergeIntoMap);
      }
    });
  }

  function updateInDeepMap(existing, keyPathIter, notSetValue, updater) {
    var isNotSet = existing === NOT_SET;
    var step = keyPathIter.next();
    if (step.done) {
      var existingValue = isNotSet ? notSetValue : existing;
      var newValue = updater(existingValue);
      return newValue === existingValue ? existing : newValue;
    }
    invariant(
      isNotSet || (existing && existing.set),
      'invalid keyPath'
    );
    var key = step.value;
    var nextExisting = isNotSet ? NOT_SET : existing.get(key, NOT_SET);
    var nextUpdated = updateInDeepMap(
      nextExisting,
      keyPathIter,
      notSetValue,
      updater
    );
    return nextUpdated === nextExisting ? existing :
      nextUpdated === NOT_SET ? existing.remove(key) :
      (isNotSet ? emptyMap() : existing).set(key, nextUpdated);
  }

  function popCount(x) {
    x = x - ((x >> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
    x = (x + (x >> 4)) & 0x0f0f0f0f;
    x = x + (x >> 8);
    x = x + (x >> 16);
    return x & 0x7f;
  }

  function setIn(array, idx, val, canEdit) {
    var newArray = canEdit ? array : arrCopy(array);
    newArray[idx] = val;
    return newArray;
  }

  function spliceIn(array, idx, val, canEdit) {
    var newLen = array.length + 1;
    if (canEdit && idx + 1 === newLen) {
      array[idx] = val;
      return array;
    }
    var newArray = new Array(newLen);
    var after = 0;
    for (var ii = 0; ii < newLen; ii++) {
      if (ii === idx) {
        newArray[ii] = val;
        after = -1;
      } else {
        newArray[ii] = array[ii + after];
      }
    }
    return newArray;
  }

  function spliceOut(array, idx, canEdit) {
    var newLen = array.length - 1;
    if (canEdit && idx === newLen) {
      array.pop();
      return array;
    }
    var newArray = new Array(newLen);
    var after = 0;
    for (var ii = 0; ii < newLen; ii++) {
      if (ii === idx) {
        after = 1;
      }
      newArray[ii] = array[ii + after];
    }
    return newArray;
  }

  var MAX_ARRAY_MAP_SIZE = SIZE / 4;
  var MAX_BITMAP_INDEXED_SIZE = SIZE / 2;
  var MIN_HASH_ARRAY_MAP_SIZE = SIZE / 4;

  createClass(List, IndexedCollection);

    // @pragma Construction

    function List(value) {
      var empty = emptyList();
      if (value === null || value === undefined) {
        return empty;
      }
      if (isList(value)) {
        return value;
      }
      var iter = IndexedIterable(value);
      var size = iter.size;
      if (size === 0) {
        return empty;
      }
      assertNotInfinite(size);
      if (size > 0 && size < SIZE) {
        return makeList(0, size, SHIFT, null, new VNode(iter.toArray()));
      }
      return empty.withMutations(function(list ) {
        list.setSize(size);
        iter.forEach(function(v, i)  {return list.set(i, v)});
      });
    }

    List.of = function(/*...values*/) {
      return this(arguments);
    };

    List.prototype.toString = function() {
      return this.__toString('List [', ']');
    };

    // @pragma Access

    List.prototype.get = function(index, notSetValue) {
      index = wrapIndex(this, index);
      if (index >= 0 && index < this.size) {
        index += this._origin;
        var node = listNodeFor(this, index);
        return node && node.array[index & MASK];
      }
      return notSetValue;
    };

    // @pragma Modification

    List.prototype.set = function(index, value) {
      return updateList(this, index, value);
    };

    List.prototype.remove = function(index) {
      return !this.has(index) ? this :
        index === 0 ? this.shift() :
        index === this.size - 1 ? this.pop() :
        this.splice(index, 1);
    };

    List.prototype.insert = function(index, value) {
      return this.splice(index, 0, value);
    };

    List.prototype.clear = function() {
      if (this.size === 0) {
        return this;
      }
      if (this.__ownerID) {
        this.size = this._origin = this._capacity = 0;
        this._level = SHIFT;
        this._root = this._tail = null;
        this.__hash = undefined;
        this.__altered = true;
        return this;
      }
      return emptyList();
    };

    List.prototype.push = function(/*...values*/) {
      var values = arguments;
      var oldSize = this.size;
      return this.withMutations(function(list ) {
        setListBounds(list, 0, oldSize + values.length);
        for (var ii = 0; ii < values.length; ii++) {
          list.set(oldSize + ii, values[ii]);
        }
      });
    };

    List.prototype.pop = function() {
      return setListBounds(this, 0, -1);
    };

    List.prototype.unshift = function(/*...values*/) {
      var values = arguments;
      return this.withMutations(function(list ) {
        setListBounds(list, -values.length);
        for (var ii = 0; ii < values.length; ii++) {
          list.set(ii, values[ii]);
        }
      });
    };

    List.prototype.shift = function() {
      return setListBounds(this, 1);
    };

    // @pragma Composition

    List.prototype.merge = function(/*...iters*/) {
      return mergeIntoListWith(this, undefined, arguments);
    };

    List.prototype.mergeWith = function(merger) {var iters = SLICE$0.call(arguments, 1);
      return mergeIntoListWith(this, merger, iters);
    };

    List.prototype.mergeDeep = function(/*...iters*/) {
      return mergeIntoListWith(this, deepMerger, arguments);
    };

    List.prototype.mergeDeepWith = function(merger) {var iters = SLICE$0.call(arguments, 1);
      return mergeIntoListWith(this, deepMergerWith(merger), iters);
    };

    List.prototype.setSize = function(size) {
      return setListBounds(this, 0, size);
    };

    // @pragma Iteration

    List.prototype.slice = function(begin, end) {
      var size = this.size;
      if (wholeSlice(begin, end, size)) {
        return this;
      }
      return setListBounds(
        this,
        resolveBegin(begin, size),
        resolveEnd(end, size)
      );
    };

    List.prototype.__iterator = function(type, reverse) {
      var index = 0;
      var values = iterateList(this, reverse);
      return new Iterator(function()  {
        var value = values();
        return value === DONE ?
          iteratorDone() :
          iteratorValue(type, index++, value);
      });
    };

    List.prototype.__iterate = function(fn, reverse) {
      var index = 0;
      var values = iterateList(this, reverse);
      var value;
      while ((value = values()) !== DONE) {
        if (fn(value, index++, this) === false) {
          break;
        }
      }
      return index;
    };

    List.prototype.__ensureOwner = function(ownerID) {
      if (ownerID === this.__ownerID) {
        return this;
      }
      if (!ownerID) {
        this.__ownerID = ownerID;
        return this;
      }
      return makeList(this._origin, this._capacity, this._level, this._root, this._tail, ownerID, this.__hash);
    };


  function isList(maybeList) {
    return !!(maybeList && maybeList[IS_LIST_SENTINEL]);
  }

  List.isList = isList;

  var IS_LIST_SENTINEL = '@@__IMMUTABLE_LIST__@@';

  var ListPrototype = List.prototype;
  ListPrototype[IS_LIST_SENTINEL] = true;
  ListPrototype[DELETE] = ListPrototype.remove;
  ListPrototype.setIn = MapPrototype.setIn;
  ListPrototype.deleteIn =
  ListPrototype.removeIn = MapPrototype.removeIn;
  ListPrototype.update = MapPrototype.update;
  ListPrototype.updateIn = MapPrototype.updateIn;
  ListPrototype.mergeIn = MapPrototype.mergeIn;
  ListPrototype.mergeDeepIn = MapPrototype.mergeDeepIn;
  ListPrototype.withMutations = MapPrototype.withMutations;
  ListPrototype.asMutable = MapPrototype.asMutable;
  ListPrototype.asImmutable = MapPrototype.asImmutable;
  ListPrototype.wasAltered = MapPrototype.wasAltered;



    function VNode(array, ownerID) {
      this.array = array;
      this.ownerID = ownerID;
    }

    // TODO: seems like these methods are very similar

    VNode.prototype.removeBefore = function(ownerID, level, index) {
      if (index === level ? 1 << level :  false || this.array.length === 0) {
        return this;
      }
      var originIndex = (index >>> level) & MASK;
      if (originIndex >= this.array.length) {
        return new VNode([], ownerID);
      }
      var removingFirst = originIndex === 0;
      var newChild;
      if (level > 0) {
        var oldChild = this.array[originIndex];
        newChild = oldChild && oldChild.removeBefore(ownerID, level - SHIFT, index);
        if (newChild === oldChild && removingFirst) {
          return this;
        }
      }
      if (removingFirst && !newChild) {
        return this;
      }
      var editable = editableVNode(this, ownerID);
      if (!removingFirst) {
        for (var ii = 0; ii < originIndex; ii++) {
          editable.array[ii] = undefined;
        }
      }
      if (newChild) {
        editable.array[originIndex] = newChild;
      }
      return editable;
    };

    VNode.prototype.removeAfter = function(ownerID, level, index) {
      if (index === (level ? 1 << level : 0) || this.array.length === 0) {
        return this;
      }
      var sizeIndex = ((index - 1) >>> level) & MASK;
      if (sizeIndex >= this.array.length) {
        return this;
      }

      var newChild;
      if (level > 0) {
        var oldChild = this.array[sizeIndex];
        newChild = oldChild && oldChild.removeAfter(ownerID, level - SHIFT, index);
        if (newChild === oldChild && sizeIndex === this.array.length - 1) {
          return this;
        }
      }

      var editable = editableVNode(this, ownerID);
      editable.array.splice(sizeIndex + 1);
      if (newChild) {
        editable.array[sizeIndex] = newChild;
      }
      return editable;
    };



  var DONE = {};

  function iterateList(list, reverse) {
    var left = list._origin;
    var right = list._capacity;
    var tailPos = getTailOffset(right);
    var tail = list._tail;

    return iterateNodeOrLeaf(list._root, list._level, 0);

    function iterateNodeOrLeaf(node, level, offset) {
      return level === 0 ?
        iterateLeaf(node, offset) :
        iterateNode(node, level, offset);
    }

    function iterateLeaf(node, offset) {
      var array = offset === tailPos ? tail && tail.array : node && node.array;
      var from = offset > left ? 0 : left - offset;
      var to = right - offset;
      if (to > SIZE) {
        to = SIZE;
      }
      return function()  {
        if (from === to) {
          return DONE;
        }
        var idx = reverse ? --to : from++;
        return array && array[idx];
      };
    }

    function iterateNode(node, level, offset) {
      var values;
      var array = node && node.array;
      var from = offset > left ? 0 : (left - offset) >> level;
      var to = ((right - offset) >> level) + 1;
      if (to > SIZE) {
        to = SIZE;
      }
      return function()  {
        do {
          if (values) {
            var value = values();
            if (value !== DONE) {
              return value;
            }
            values = null;
          }
          if (from === to) {
            return DONE;
          }
          var idx = reverse ? --to : from++;
          values = iterateNodeOrLeaf(
            array && array[idx], level - SHIFT, offset + (idx << level)
          );
        } while (true);
      };
    }
  }

  function makeList(origin, capacity, level, root, tail, ownerID, hash) {
    var list = Object.create(ListPrototype);
    list.size = capacity - origin;
    list._origin = origin;
    list._capacity = capacity;
    list._level = level;
    list._root = root;
    list._tail = tail;
    list.__ownerID = ownerID;
    list.__hash = hash;
    list.__altered = false;
    return list;
  }

  var EMPTY_LIST;
  function emptyList() {
    return EMPTY_LIST || (EMPTY_LIST = makeList(0, 0, SHIFT));
  }

  function updateList(list, index, value) {
    index = wrapIndex(list, index);

    if (index !== index) {
      return list;
    }

    if (index >= list.size || index < 0) {
      return list.withMutations(function(list ) {
        index < 0 ?
          setListBounds(list, index).set(0, value) :
          setListBounds(list, 0, index + 1).set(index, value)
      });
    }

    index += list._origin;

    var newTail = list._tail;
    var newRoot = list._root;
    var didAlter = MakeRef(DID_ALTER);
    if (index >= getTailOffset(list._capacity)) {
      newTail = updateVNode(newTail, list.__ownerID, 0, index, value, didAlter);
    } else {
      newRoot = updateVNode(newRoot, list.__ownerID, list._level, index, value, didAlter);
    }

    if (!didAlter.value) {
      return list;
    }

    if (list.__ownerID) {
      list._root = newRoot;
      list._tail = newTail;
      list.__hash = undefined;
      list.__altered = true;
      return list;
    }
    return makeList(list._origin, list._capacity, list._level, newRoot, newTail);
  }

  function updateVNode(node, ownerID, level, index, value, didAlter) {
    var idx = (index >>> level) & MASK;
    var nodeHas = node && idx < node.array.length;
    if (!nodeHas && value === undefined) {
      return node;
    }

    var newNode;

    if (level > 0) {
      var lowerNode = node && node.array[idx];
      var newLowerNode = updateVNode(lowerNode, ownerID, level - SHIFT, index, value, didAlter);
      if (newLowerNode === lowerNode) {
        return node;
      }
      newNode = editableVNode(node, ownerID);
      newNode.array[idx] = newLowerNode;
      return newNode;
    }

    if (nodeHas && node.array[idx] === value) {
      return node;
    }

    SetRef(didAlter);

    newNode = editableVNode(node, ownerID);
    if (value === undefined && idx === newNode.array.length - 1) {
      newNode.array.pop();
    } else {
      newNode.array[idx] = value;
    }
    return newNode;
  }

  function editableVNode(node, ownerID) {
    if (ownerID && node && ownerID === node.ownerID) {
      return node;
    }
    return new VNode(node ? node.array.slice() : [], ownerID);
  }

  function listNodeFor(list, rawIndex) {
    if (rawIndex >= getTailOffset(list._capacity)) {
      return list._tail;
    }
    if (rawIndex < 1 << (list._level + SHIFT)) {
      var node = list._root;
      var level = list._level;
      while (node && level > 0) {
        node = node.array[(rawIndex >>> level) & MASK];
        level -= SHIFT;
      }
      return node;
    }
  }

  function setListBounds(list, begin, end) {
    // Sanitize begin & end using this shorthand for ToInt32(argument)
    // http://www.ecma-international.org/ecma-262/6.0/#sec-toint32
    if (begin !== undefined) {
      begin = begin | 0;
    }
    if (end !== undefined) {
      end = end | 0;
    }
    var owner = list.__ownerID || new OwnerID();
    var oldOrigin = list._origin;
    var oldCapacity = list._capacity;
    var newOrigin = oldOrigin + begin;
    var newCapacity = end === undefined ? oldCapacity : end < 0 ? oldCapacity + end : oldOrigin + end;
    if (newOrigin === oldOrigin && newCapacity === oldCapacity) {
      return list;
    }

    // If it's going to end after it starts, it's empty.
    if (newOrigin >= newCapacity) {
      return list.clear();
    }

    var newLevel = list._level;
    var newRoot = list._root;

    // New origin might need creating a higher root.
    var offsetShift = 0;
    while (newOrigin + offsetShift < 0) {
      newRoot = new VNode(newRoot && newRoot.array.length ? [undefined, newRoot] : [], owner);
      newLevel += SHIFT;
      offsetShift += 1 << newLevel;
    }
    if (offsetShift) {
      newOrigin += offsetShift;
      oldOrigin += offsetShift;
      newCapacity += offsetShift;
      oldCapacity += offsetShift;
    }

    var oldTailOffset = getTailOffset(oldCapacity);
    var newTailOffset = getTailOffset(newCapacity);

    // New size might need creating a higher root.
    while (newTailOffset >= 1 << (newLevel + SHIFT)) {
      newRoot = new VNode(newRoot && newRoot.array.length ? [newRoot] : [], owner);
      newLevel += SHIFT;
    }

    // Locate or create the new tail.
    var oldTail = list._tail;
    var newTail = newTailOffset < oldTailOffset ?
      listNodeFor(list, newCapacity - 1) :
      newTailOffset > oldTailOffset ? new VNode([], owner) : oldTail;

    // Merge Tail into tree.
    if (oldTail && newTailOffset > oldTailOffset && newOrigin < oldCapacity && oldTail.array.length) {
      newRoot = editableVNode(newRoot, owner);
      var node = newRoot;
      for (var level = newLevel; level > SHIFT; level -= SHIFT) {
        var idx = (oldTailOffset >>> level) & MASK;
        node = node.array[idx] = editableVNode(node.array[idx], owner);
      }
      node.array[(oldTailOffset >>> SHIFT) & MASK] = oldTail;
    }

    // If the size has been reduced, there's a chance the tail needs to be trimmed.
    if (newCapacity < oldCapacity) {
      newTail = newTail && newTail.removeAfter(owner, 0, newCapacity);
    }

    // If the new origin is within the tail, then we do not need a root.
    if (newOrigin >= newTailOffset) {
      newOrigin -= newTailOffset;
      newCapacity -= newTailOffset;
      newLevel = SHIFT;
      newRoot = null;
      newTail = newTail && newTail.removeBefore(owner, 0, newOrigin);

    // Otherwise, if the root has been trimmed, garbage collect.
    } else if (newOrigin > oldOrigin || newTailOffset < oldTailOffset) {
      offsetShift = 0;

      // Identify the new top root node of the subtree of the old root.
      while (newRoot) {
        var beginIndex = (newOrigin >>> newLevel) & MASK;
        if (beginIndex !== (newTailOffset >>> newLevel) & MASK) {
          break;
        }
        if (beginIndex) {
          offsetShift += (1 << newLevel) * beginIndex;
        }
        newLevel -= SHIFT;
        newRoot = newRoot.array[beginIndex];
      }

      // Trim the new sides of the new root.
      if (newRoot && newOrigin > oldOrigin) {
        newRoot = newRoot.removeBefore(owner, newLevel, newOrigin - offsetShift);
      }
      if (newRoot && newTailOffset < oldTailOffset) {
        newRoot = newRoot.removeAfter(owner, newLevel, newTailOffset - offsetShift);
      }
      if (offsetShift) {
        newOrigin -= offsetShift;
        newCapacity -= offsetShift;
      }
    }

    if (list.__ownerID) {
      list.size = newCapacity - newOrigin;
      list._origin = newOrigin;
      list._capacity = newCapacity;
      list._level = newLevel;
      list._root = newRoot;
      list._tail = newTail;
      list.__hash = undefined;
      list.__altered = true;
      return list;
    }
    return makeList(newOrigin, newCapacity, newLevel, newRoot, newTail);
  }

  function mergeIntoListWith(list, merger, iterables) {
    var iters = [];
    var maxSize = 0;
    for (var ii = 0; ii < iterables.length; ii++) {
      var value = iterables[ii];
      var iter = IndexedIterable(value);
      if (iter.size > maxSize) {
        maxSize = iter.size;
      }
      if (!isIterable(value)) {
        iter = iter.map(function(v ) {return fromJS(v)});
      }
      iters.push(iter);
    }
    if (maxSize > list.size) {
      list = list.setSize(maxSize);
    }
    return mergeIntoCollectionWith(list, merger, iters);
  }

  function getTailOffset(size) {
    return size < SIZE ? 0 : (((size - 1) >>> SHIFT) << SHIFT);
  }

  createClass(OrderedMap, Map);

    // @pragma Construction

    function OrderedMap(value) {
      return value === null || value === undefined ? emptyOrderedMap() :
        isOrderedMap(value) ? value :
        emptyOrderedMap().withMutations(function(map ) {
          var iter = KeyedIterable(value);
          assertNotInfinite(iter.size);
          iter.forEach(function(v, k)  {return map.set(k, v)});
        });
    }

    OrderedMap.of = function(/*...values*/) {
      return this(arguments);
    };

    OrderedMap.prototype.toString = function() {
      return this.__toString('OrderedMap {', '}');
    };

    // @pragma Access

    OrderedMap.prototype.get = function(k, notSetValue) {
      var index = this._map.get(k);
      return index !== undefined ? this._list.get(index)[1] : notSetValue;
    };

    // @pragma Modification

    OrderedMap.prototype.clear = function() {
      if (this.size === 0) {
        return this;
      }
      if (this.__ownerID) {
        this.size = 0;
        this._map.clear();
        this._list.clear();
        return this;
      }
      return emptyOrderedMap();
    };

    OrderedMap.prototype.set = function(k, v) {
      return updateOrderedMap(this, k, v);
    };

    OrderedMap.prototype.remove = function(k) {
      return updateOrderedMap(this, k, NOT_SET);
    };

    OrderedMap.prototype.wasAltered = function() {
      return this._map.wasAltered() || this._list.wasAltered();
    };

    OrderedMap.prototype.__iterate = function(fn, reverse) {var this$0 = this;
      return this._list.__iterate(
        function(entry ) {return entry && fn(entry[1], entry[0], this$0)},
        reverse
      );
    };

    OrderedMap.prototype.__iterator = function(type, reverse) {
      return this._list.fromEntrySeq().__iterator(type, reverse);
    };

    OrderedMap.prototype.__ensureOwner = function(ownerID) {
      if (ownerID === this.__ownerID) {
        return this;
      }
      var newMap = this._map.__ensureOwner(ownerID);
      var newList = this._list.__ensureOwner(ownerID);
      if (!ownerID) {
        this.__ownerID = ownerID;
        this._map = newMap;
        this._list = newList;
        return this;
      }
      return makeOrderedMap(newMap, newList, ownerID, this.__hash);
    };


  function isOrderedMap(maybeOrderedMap) {
    return isMap(maybeOrderedMap) && isOrdered(maybeOrderedMap);
  }

  OrderedMap.isOrderedMap = isOrderedMap;

  OrderedMap.prototype[IS_ORDERED_SENTINEL] = true;
  OrderedMap.prototype[DELETE] = OrderedMap.prototype.remove;



  function makeOrderedMap(map, list, ownerID, hash) {
    var omap = Object.create(OrderedMap.prototype);
    omap.size = map ? map.size : 0;
    omap._map = map;
    omap._list = list;
    omap.__ownerID = ownerID;
    omap.__hash = hash;
    return omap;
  }

  var EMPTY_ORDERED_MAP;
  function emptyOrderedMap() {
    return EMPTY_ORDERED_MAP || (EMPTY_ORDERED_MAP = makeOrderedMap(emptyMap(), emptyList()));
  }

  function updateOrderedMap(omap, k, v) {
    var map = omap._map;
    var list = omap._list;
    var i = map.get(k);
    var has = i !== undefined;
    var newMap;
    var newList;
    if (v === NOT_SET) { // removed
      if (!has) {
        return omap;
      }
      if (list.size >= SIZE && list.size >= map.size * 2) {
        newList = list.filter(function(entry, idx)  {return entry !== undefined && i !== idx});
        newMap = newList.toKeyedSeq().map(function(entry ) {return entry[0]}).flip().toMap();
        if (omap.__ownerID) {
          newMap.__ownerID = newList.__ownerID = omap.__ownerID;
        }
      } else {
        newMap = map.remove(k);
        newList = i === list.size - 1 ? list.pop() : list.set(i, undefined);
      }
    } else {
      if (has) {
        if (v === list.get(i)[1]) {
          return omap;
        }
        newMap = map;
        newList = list.set(i, [k, v]);
      } else {
        newMap = map.set(k, list.size);
        newList = list.set(list.size, [k, v]);
      }
    }
    if (omap.__ownerID) {
      omap.size = newMap.size;
      omap._map = newMap;
      omap._list = newList;
      omap.__hash = undefined;
      return omap;
    }
    return makeOrderedMap(newMap, newList);
  }

  createClass(ToKeyedSequence, KeyedSeq);
    function ToKeyedSequence(indexed, useKeys) {
      this._iter = indexed;
      this._useKeys = useKeys;
      this.size = indexed.size;
    }

    ToKeyedSequence.prototype.get = function(key, notSetValue) {
      return this._iter.get(key, notSetValue);
    };

    ToKeyedSequence.prototype.has = function(key) {
      return this._iter.has(key);
    };

    ToKeyedSequence.prototype.valueSeq = function() {
      return this._iter.valueSeq();
    };

    ToKeyedSequence.prototype.reverse = function() {var this$0 = this;
      var reversedSequence = reverseFactory(this, true);
      if (!this._useKeys) {
        reversedSequence.valueSeq = function()  {return this$0._iter.toSeq().reverse()};
      }
      return reversedSequence;
    };

    ToKeyedSequence.prototype.map = function(mapper, context) {var this$0 = this;
      var mappedSequence = mapFactory(this, mapper, context);
      if (!this._useKeys) {
        mappedSequence.valueSeq = function()  {return this$0._iter.toSeq().map(mapper, context)};
      }
      return mappedSequence;
    };

    ToKeyedSequence.prototype.__iterate = function(fn, reverse) {var this$0 = this;
      var ii;
      return this._iter.__iterate(
        this._useKeys ?
          function(v, k)  {return fn(v, k, this$0)} :
          ((ii = reverse ? resolveSize(this) : 0),
            function(v ) {return fn(v, reverse ? --ii : ii++, this$0)}),
        reverse
      );
    };

    ToKeyedSequence.prototype.__iterator = function(type, reverse) {
      if (this._useKeys) {
        return this._iter.__iterator(type, reverse);
      }
      var iterator = this._iter.__iterator(ITERATE_VALUES, reverse);
      var ii = reverse ? resolveSize(this) : 0;
      return new Iterator(function()  {
        var step = iterator.next();
        return step.done ? step :
          iteratorValue(type, reverse ? --ii : ii++, step.value, step);
      });
    };

  ToKeyedSequence.prototype[IS_ORDERED_SENTINEL] = true;


  createClass(ToIndexedSequence, IndexedSeq);
    function ToIndexedSequence(iter) {
      this._iter = iter;
      this.size = iter.size;
    }

    ToIndexedSequence.prototype.includes = function(value) {
      return this._iter.includes(value);
    };

    ToIndexedSequence.prototype.__iterate = function(fn, reverse) {var this$0 = this;
      var iterations = 0;
      return this._iter.__iterate(function(v ) {return fn(v, iterations++, this$0)}, reverse);
    };

    ToIndexedSequence.prototype.__iterator = function(type, reverse) {
      var iterator = this._iter.__iterator(ITERATE_VALUES, reverse);
      var iterations = 0;
      return new Iterator(function()  {
        var step = iterator.next();
        return step.done ? step :
          iteratorValue(type, iterations++, step.value, step)
      });
    };



  createClass(ToSetSequence, SetSeq);
    function ToSetSequence(iter) {
      this._iter = iter;
      this.size = iter.size;
    }

    ToSetSequence.prototype.has = function(key) {
      return this._iter.includes(key);
    };

    ToSetSequence.prototype.__iterate = function(fn, reverse) {var this$0 = this;
      return this._iter.__iterate(function(v ) {return fn(v, v, this$0)}, reverse);
    };

    ToSetSequence.prototype.__iterator = function(type, reverse) {
      var iterator = this._iter.__iterator(ITERATE_VALUES, reverse);
      return new Iterator(function()  {
        var step = iterator.next();
        return step.done ? step :
          iteratorValue(type, step.value, step.value, step);
      });
    };



  createClass(FromEntriesSequence, KeyedSeq);
    function FromEntriesSequence(entries) {
      this._iter = entries;
      this.size = entries.size;
    }

    FromEntriesSequence.prototype.entrySeq = function() {
      return this._iter.toSeq();
    };

    FromEntriesSequence.prototype.__iterate = function(fn, reverse) {var this$0 = this;
      return this._iter.__iterate(function(entry ) {
        // Check if entry exists first so array access doesn't throw for holes
        // in the parent iteration.
        if (entry) {
          validateEntry(entry);
          var indexedIterable = isIterable(entry);
          return fn(
            indexedIterable ? entry.get(1) : entry[1],
            indexedIterable ? entry.get(0) : entry[0],
            this$0
          );
        }
      }, reverse);
    };

    FromEntriesSequence.prototype.__iterator = function(type, reverse) {
      var iterator = this._iter.__iterator(ITERATE_VALUES, reverse);
      return new Iterator(function()  {
        while (true) {
          var step = iterator.next();
          if (step.done) {
            return step;
          }
          var entry = step.value;
          // Check if entry exists first so array access doesn't throw for holes
          // in the parent iteration.
          if (entry) {
            validateEntry(entry);
            var indexedIterable = isIterable(entry);
            return iteratorValue(
              type,
              indexedIterable ? entry.get(0) : entry[0],
              indexedIterable ? entry.get(1) : entry[1],
              step
            );
          }
        }
      });
    };


  ToIndexedSequence.prototype.cacheResult =
  ToKeyedSequence.prototype.cacheResult =
  ToSetSequence.prototype.cacheResult =
  FromEntriesSequence.prototype.cacheResult =
    cacheResultThrough;


  function flipFactory(iterable) {
    var flipSequence = makeSequence(iterable);
    flipSequence._iter = iterable;
    flipSequence.size = iterable.size;
    flipSequence.flip = function()  {return iterable};
    flipSequence.reverse = function () {
      var reversedSequence = iterable.reverse.apply(this); // super.reverse()
      reversedSequence.flip = function()  {return iterable.reverse()};
      return reversedSequence;
    };
    flipSequence.has = function(key ) {return iterable.includes(key)};
    flipSequence.includes = function(key ) {return iterable.has(key)};
    flipSequence.cacheResult = cacheResultThrough;
    flipSequence.__iterateUncached = function (fn, reverse) {var this$0 = this;
      return iterable.__iterate(function(v, k)  {return fn(k, v, this$0) !== false}, reverse);
    }
    flipSequence.__iteratorUncached = function(type, reverse) {
      if (type === ITERATE_ENTRIES) {
        var iterator = iterable.__iterator(type, reverse);
        return new Iterator(function()  {
          var step = iterator.next();
          if (!step.done) {
            var k = step.value[0];
            step.value[0] = step.value[1];
            step.value[1] = k;
          }
          return step;
        });
      }
      return iterable.__iterator(
        type === ITERATE_VALUES ? ITERATE_KEYS : ITERATE_VALUES,
        reverse
      );
    }
    return flipSequence;
  }


  function mapFactory(iterable, mapper, context) {
    var mappedSequence = makeSequence(iterable);
    mappedSequence.size = iterable.size;
    mappedSequence.has = function(key ) {return iterable.has(key)};
    mappedSequence.get = function(key, notSetValue)  {
      var v = iterable.get(key, NOT_SET);
      return v === NOT_SET ?
        notSetValue :
        mapper.call(context, v, key, iterable);
    };
    mappedSequence.__iterateUncached = function (fn, reverse) {var this$0 = this;
      return iterable.__iterate(
        function(v, k, c)  {return fn(mapper.call(context, v, k, c), k, this$0) !== false},
        reverse
      );
    }
    mappedSequence.__iteratorUncached = function (type, reverse) {
      var iterator = iterable.__iterator(ITERATE_ENTRIES, reverse);
      return new Iterator(function()  {
        var step = iterator.next();
        if (step.done) {
          return step;
        }
        var entry = step.value;
        var key = entry[0];
        return iteratorValue(
          type,
          key,
          mapper.call(context, entry[1], key, iterable),
          step
        );
      });
    }
    return mappedSequence;
  }


  function reverseFactory(iterable, useKeys) {
    var reversedSequence = makeSequence(iterable);
    reversedSequence._iter = iterable;
    reversedSequence.size = iterable.size;
    reversedSequence.reverse = function()  {return iterable};
    if (iterable.flip) {
      reversedSequence.flip = function () {
        var flipSequence = flipFactory(iterable);
        flipSequence.reverse = function()  {return iterable.flip()};
        return flipSequence;
      };
    }
    reversedSequence.get = function(key, notSetValue) 
      {return iterable.get(useKeys ? key : -1 - key, notSetValue)};
    reversedSequence.has = function(key )
      {return iterable.has(useKeys ? key : -1 - key)};
    reversedSequence.includes = function(value ) {return iterable.includes(value)};
    reversedSequence.cacheResult = cacheResultThrough;
    reversedSequence.__iterate = function (fn, reverse) {var this$0 = this;
      return iterable.__iterate(function(v, k)  {return fn(v, k, this$0)}, !reverse);
    };
    reversedSequence.__iterator =
      function(type, reverse)  {return iterable.__iterator(type, !reverse)};
    return reversedSequence;
  }


  function filterFactory(iterable, predicate, context, useKeys) {
    var filterSequence = makeSequence(iterable);
    if (useKeys) {
      filterSequence.has = function(key ) {
        var v = iterable.get(key, NOT_SET);
        return v !== NOT_SET && !!predicate.call(context, v, key, iterable);
      };
      filterSequence.get = function(key, notSetValue)  {
        var v = iterable.get(key, NOT_SET);
        return v !== NOT_SET && predicate.call(context, v, key, iterable) ?
          v : notSetValue;
      };
    }
    filterSequence.__iterateUncached = function (fn, reverse) {var this$0 = this;
      var iterations = 0;
      iterable.__iterate(function(v, k, c)  {
        if (predicate.call(context, v, k, c)) {
          iterations++;
          return fn(v, useKeys ? k : iterations - 1, this$0);
        }
      }, reverse);
      return iterations;
    };
    filterSequence.__iteratorUncached = function (type, reverse) {
      var iterator = iterable.__iterator(ITERATE_ENTRIES, reverse);
      var iterations = 0;
      return new Iterator(function()  {
        while (true) {
          var step = iterator.next();
          if (step.done) {
            return step;
          }
          var entry = step.value;
          var key = entry[0];
          var value = entry[1];
          if (predicate.call(context, value, key, iterable)) {
            return iteratorValue(type, useKeys ? key : iterations++, value, step);
          }
        }
      });
    }
    return filterSequence;
  }


  function countByFactory(iterable, grouper, context) {
    var groups = Map().asMutable();
    iterable.__iterate(function(v, k)  {
      groups.update(
        grouper.call(context, v, k, iterable),
        0,
        function(a ) {return a + 1}
      );
    });
    return groups.asImmutable();
  }


  function groupByFactory(iterable, grouper, context) {
    var isKeyedIter = isKeyed(iterable);
    var groups = (isOrdered(iterable) ? OrderedMap() : Map()).asMutable();
    iterable.__iterate(function(v, k)  {
      groups.update(
        grouper.call(context, v, k, iterable),
        function(a ) {return (a = a || [], a.push(isKeyedIter ? [k, v] : v), a)}
      );
    });
    var coerce = iterableClass(iterable);
    return groups.map(function(arr ) {return reify(iterable, coerce(arr))});
  }


  function sliceFactory(iterable, begin, end, useKeys) {
    var originalSize = iterable.size;

    // Sanitize begin & end using this shorthand for ToInt32(argument)
    // http://www.ecma-international.org/ecma-262/6.0/#sec-toint32
    if (begin !== undefined) {
      begin = begin | 0;
    }
    if (end !== undefined) {
      if (end === Infinity) {
        end = originalSize;
      } else {
        end = end | 0;
      }
    }

    if (wholeSlice(begin, end, originalSize)) {
      return iterable;
    }

    var resolvedBegin = resolveBegin(begin, originalSize);
    var resolvedEnd = resolveEnd(end, originalSize);

    // begin or end will be NaN if they were provided as negative numbers and
    // this iterable's size is unknown. In that case, cache first so there is
    // a known size and these do not resolve to NaN.
    if (resolvedBegin !== resolvedBegin || resolvedEnd !== resolvedEnd) {
      return sliceFactory(iterable.toSeq().cacheResult(), begin, end, useKeys);
    }

    // Note: resolvedEnd is undefined when the original sequence's length is
    // unknown and this slice did not supply an end and should contain all
    // elements after resolvedBegin.
    // In that case, resolvedSize will be NaN and sliceSize will remain undefined.
    var resolvedSize = resolvedEnd - resolvedBegin;
    var sliceSize;
    if (resolvedSize === resolvedSize) {
      sliceSize = resolvedSize < 0 ? 0 : resolvedSize;
    }

    var sliceSeq = makeSequence(iterable);

    // If iterable.size is undefined, the size of the realized sliceSeq is
    // unknown at this point unless the number of items to slice is 0
    sliceSeq.size = sliceSize === 0 ? sliceSize : iterable.size && sliceSize || undefined;

    if (!useKeys && isSeq(iterable) && sliceSize >= 0) {
      sliceSeq.get = function (index, notSetValue) {
        index = wrapIndex(this, index);
        return index >= 0 && index < sliceSize ?
          iterable.get(index + resolvedBegin, notSetValue) :
          notSetValue;
      }
    }

    sliceSeq.__iterateUncached = function(fn, reverse) {var this$0 = this;
      if (sliceSize === 0) {
        return 0;
      }
      if (reverse) {
        return this.cacheResult().__iterate(fn, reverse);
      }
      var skipped = 0;
      var isSkipping = true;
      var iterations = 0;
      iterable.__iterate(function(v, k)  {
        if (!(isSkipping && (isSkipping = skipped++ < resolvedBegin))) {
          iterations++;
          return fn(v, useKeys ? k : iterations - 1, this$0) !== false &&
                 iterations !== sliceSize;
        }
      });
      return iterations;
    };

    sliceSeq.__iteratorUncached = function(type, reverse) {
      if (sliceSize !== 0 && reverse) {
        return this.cacheResult().__iterator(type, reverse);
      }
      // Don't bother instantiating parent iterator if taking 0.
      var iterator = sliceSize !== 0 && iterable.__iterator(type, reverse);
      var skipped = 0;
      var iterations = 0;
      return new Iterator(function()  {
        while (skipped++ < resolvedBegin) {
          iterator.next();
        }
        if (++iterations > sliceSize) {
          return iteratorDone();
        }
        var step = iterator.next();
        if (useKeys || type === ITERATE_VALUES) {
          return step;
        } else if (type === ITERATE_KEYS) {
          return iteratorValue(type, iterations - 1, undefined, step);
        } else {
          return iteratorValue(type, iterations - 1, step.value[1], step);
        }
      });
    }

    return sliceSeq;
  }


  function takeWhileFactory(iterable, predicate, context) {
    var takeSequence = makeSequence(iterable);
    takeSequence.__iterateUncached = function(fn, reverse) {var this$0 = this;
      if (reverse) {
        return this.cacheResult().__iterate(fn, reverse);
      }
      var iterations = 0;
      iterable.__iterate(function(v, k, c) 
        {return predicate.call(context, v, k, c) && ++iterations && fn(v, k, this$0)}
      );
      return iterations;
    };
    takeSequence.__iteratorUncached = function(type, reverse) {var this$0 = this;
      if (reverse) {
        return this.cacheResult().__iterator(type, reverse);
      }
      var iterator = iterable.__iterator(ITERATE_ENTRIES, reverse);
      var iterating = true;
      return new Iterator(function()  {
        if (!iterating) {
          return iteratorDone();
        }
        var step = iterator.next();
        if (step.done) {
          return step;
        }
        var entry = step.value;
        var k = entry[0];
        var v = entry[1];
        if (!predicate.call(context, v, k, this$0)) {
          iterating = false;
          return iteratorDone();
        }
        return type === ITERATE_ENTRIES ? step :
          iteratorValue(type, k, v, step);
      });
    };
    return takeSequence;
  }


  function skipWhileFactory(iterable, predicate, context, useKeys) {
    var skipSequence = makeSequence(iterable);
    skipSequence.__iterateUncached = function (fn, reverse) {var this$0 = this;
      if (reverse) {
        return this.cacheResult().__iterate(fn, reverse);
      }
      var isSkipping = true;
      var iterations = 0;
      iterable.__iterate(function(v, k, c)  {
        if (!(isSkipping && (isSkipping = predicate.call(context, v, k, c)))) {
          iterations++;
          return fn(v, useKeys ? k : iterations - 1, this$0);
        }
      });
      return iterations;
    };
    skipSequence.__iteratorUncached = function(type, reverse) {var this$0 = this;
      if (reverse) {
        return this.cacheResult().__iterator(type, reverse);
      }
      var iterator = iterable.__iterator(ITERATE_ENTRIES, reverse);
      var skipping = true;
      var iterations = 0;
      return new Iterator(function()  {
        var step, k, v;
        do {
          step = iterator.next();
          if (step.done) {
            if (useKeys || type === ITERATE_VALUES) {
              return step;
            } else if (type === ITERATE_KEYS) {
              return iteratorValue(type, iterations++, undefined, step);
            } else {
              return iteratorValue(type, iterations++, step.value[1], step);
            }
          }
          var entry = step.value;
          k = entry[0];
          v = entry[1];
          skipping && (skipping = predicate.call(context, v, k, this$0));
        } while (skipping);
        return type === ITERATE_ENTRIES ? step :
          iteratorValue(type, k, v, step);
      });
    };
    return skipSequence;
  }


  function concatFactory(iterable, values) {
    var isKeyedIterable = isKeyed(iterable);
    var iters = [iterable].concat(values).map(function(v ) {
      if (!isIterable(v)) {
        v = isKeyedIterable ?
          keyedSeqFromValue(v) :
          indexedSeqFromValue(Array.isArray(v) ? v : [v]);
      } else if (isKeyedIterable) {
        v = KeyedIterable(v);
      }
      return v;
    }).filter(function(v ) {return v.size !== 0});

    if (iters.length === 0) {
      return iterable;
    }

    if (iters.length === 1) {
      var singleton = iters[0];
      if (singleton === iterable ||
          isKeyedIterable && isKeyed(singleton) ||
          isIndexed(iterable) && isIndexed(singleton)) {
        return singleton;
      }
    }

    var concatSeq = new ArraySeq(iters);
    if (isKeyedIterable) {
      concatSeq = concatSeq.toKeyedSeq();
    } else if (!isIndexed(iterable)) {
      concatSeq = concatSeq.toSetSeq();
    }
    concatSeq = concatSeq.flatten(true);
    concatSeq.size = iters.reduce(
      function(sum, seq)  {
        if (sum !== undefined) {
          var size = seq.size;
          if (size !== undefined) {
            return sum + size;
          }
        }
      },
      0
    );
    return concatSeq;
  }


  function flattenFactory(iterable, depth, useKeys) {
    var flatSequence = makeSequence(iterable);
    flatSequence.__iterateUncached = function(fn, reverse) {
      var iterations = 0;
      var stopped = false;
      function flatDeep(iter, currentDepth) {var this$0 = this;
        iter.__iterate(function(v, k)  {
          if ((!depth || currentDepth < depth) && isIterable(v)) {
            flatDeep(v, currentDepth + 1);
          } else if (fn(v, useKeys ? k : iterations++, this$0) === false) {
            stopped = true;
          }
          return !stopped;
        }, reverse);
      }
      flatDeep(iterable, 0);
      return iterations;
    }
    flatSequence.__iteratorUncached = function(type, reverse) {
      var iterator = iterable.__iterator(type, reverse);
      var stack = [];
      var iterations = 0;
      return new Iterator(function()  {
        while (iterator) {
          var step = iterator.next();
          if (step.done !== false) {
            iterator = stack.pop();
            continue;
          }
          var v = step.value;
          if (type === ITERATE_ENTRIES) {
            v = v[1];
          }
          if ((!depth || stack.length < depth) && isIterable(v)) {
            stack.push(iterator);
            iterator = v.__iterator(type, reverse);
          } else {
            return useKeys ? step : iteratorValue(type, iterations++, v, step);
          }
        }
        return iteratorDone();
      });
    }
    return flatSequence;
  }


  function flatMapFactory(iterable, mapper, context) {
    var coerce = iterableClass(iterable);
    return iterable.toSeq().map(
      function(v, k)  {return coerce(mapper.call(context, v, k, iterable))}
    ).flatten(true);
  }


  function interposeFactory(iterable, separator) {
    var interposedSequence = makeSequence(iterable);
    interposedSequence.size = iterable.size && iterable.size * 2 -1;
    interposedSequence.__iterateUncached = function(fn, reverse) {var this$0 = this;
      var iterations = 0;
      iterable.__iterate(function(v, k) 
        {return (!iterations || fn(separator, iterations++, this$0) !== false) &&
        fn(v, iterations++, this$0) !== false},
        reverse
      );
      return iterations;
    };
    interposedSequence.__iteratorUncached = function(type, reverse) {
      var iterator = iterable.__iterator(ITERATE_VALUES, reverse);
      var iterations = 0;
      var step;
      return new Iterator(function()  {
        if (!step || iterations % 2) {
          step = iterator.next();
          if (step.done) {
            return step;
          }
        }
        return iterations % 2 ?
          iteratorValue(type, iterations++, separator) :
          iteratorValue(type, iterations++, step.value, step);
      });
    };
    return interposedSequence;
  }


  function sortFactory(iterable, comparator, mapper) {
    if (!comparator) {
      comparator = defaultComparator;
    }
    var isKeyedIterable = isKeyed(iterable);
    var index = 0;
    var entries = iterable.toSeq().map(
      function(v, k)  {return [k, v, index++, mapper ? mapper(v, k, iterable) : v]}
    ).toArray();
    entries.sort(function(a, b)  {return comparator(a[3], b[3]) || a[2] - b[2]}).forEach(
      isKeyedIterable ?
      function(v, i)  { entries[i].length = 2; } :
      function(v, i)  { entries[i] = v[1]; }
    );
    return isKeyedIterable ? KeyedSeq(entries) :
      isIndexed(iterable) ? IndexedSeq(entries) :
      SetSeq(entries);
  }


  function maxFactory(iterable, comparator, mapper) {
    if (!comparator) {
      comparator = defaultComparator;
    }
    if (mapper) {
      var entry = iterable.toSeq()
        .map(function(v, k)  {return [v, mapper(v, k, iterable)]})
        .reduce(function(a, b)  {return maxCompare(comparator, a[1], b[1]) ? b : a});
      return entry && entry[0];
    } else {
      return iterable.reduce(function(a, b)  {return maxCompare(comparator, a, b) ? b : a});
    }
  }

  function maxCompare(comparator, a, b) {
    var comp = comparator(b, a);
    // b is considered the new max if the comparator declares them equal, but
    // they are not equal and b is in fact a nullish value.
    return (comp === 0 && b !== a && (b === undefined || b === null || b !== b)) || comp > 0;
  }


  function zipWithFactory(keyIter, zipper, iters) {
    var zipSequence = makeSequence(keyIter);
    zipSequence.size = new ArraySeq(iters).map(function(i ) {return i.size}).min();
    // Note: this a generic base implementation of __iterate in terms of
    // __iterator which may be more generically useful in the future.
    zipSequence.__iterate = function(fn, reverse) {
      /* generic:
      var iterator = this.__iterator(ITERATE_ENTRIES, reverse);
      var step;
      var iterations = 0;
      while (!(step = iterator.next()).done) {
        iterations++;
        if (fn(step.value[1], step.value[0], this) === false) {
          break;
        }
      }
      return iterations;
      */
      // indexed:
      var iterator = this.__iterator(ITERATE_VALUES, reverse);
      var step;
      var iterations = 0;
      while (!(step = iterator.next()).done) {
        if (fn(step.value, iterations++, this) === false) {
          break;
        }
      }
      return iterations;
    };
    zipSequence.__iteratorUncached = function(type, reverse) {
      var iterators = iters.map(function(i )
        {return (i = Iterable(i), getIterator(reverse ? i.reverse() : i))}
      );
      var iterations = 0;
      var isDone = false;
      return new Iterator(function()  {
        var steps;
        if (!isDone) {
          steps = iterators.map(function(i ) {return i.next()});
          isDone = steps.some(function(s ) {return s.done});
        }
        if (isDone) {
          return iteratorDone();
        }
        return iteratorValue(
          type,
          iterations++,
          zipper.apply(null, steps.map(function(s ) {return s.value}))
        );
      });
    };
    return zipSequence
  }


  // #pragma Helper Functions

  function reify(iter, seq) {
    return isSeq(iter) ? seq : iter.constructor(seq);
  }

  function validateEntry(entry) {
    if (entry !== Object(entry)) {
      throw new TypeError('Expected [K, V] tuple: ' + entry);
    }
  }

  function resolveSize(iter) {
    assertNotInfinite(iter.size);
    return ensureSize(iter);
  }

  function iterableClass(iterable) {
    return isKeyed(iterable) ? KeyedIterable :
      isIndexed(iterable) ? IndexedIterable :
      SetIterable;
  }

  function makeSequence(iterable) {
    return Object.create(
      (
        isKeyed(iterable) ? KeyedSeq :
        isIndexed(iterable) ? IndexedSeq :
        SetSeq
      ).prototype
    );
  }

  function cacheResultThrough() {
    if (this._iter.cacheResult) {
      this._iter.cacheResult();
      this.size = this._iter.size;
      return this;
    } else {
      return Seq.prototype.cacheResult.call(this);
    }
  }

  function defaultComparator(a, b) {
    return a > b ? 1 : a < b ? -1 : 0;
  }

  function forceIterator(keyPath) {
    var iter = getIterator(keyPath);
    if (!iter) {
      // Array might not be iterable in this environment, so we need a fallback
      // to our wrapped type.
      if (!isArrayLike(keyPath)) {
        throw new TypeError('Expected iterable or array-like: ' + keyPath);
      }
      iter = getIterator(Iterable(keyPath));
    }
    return iter;
  }

  createClass(Record, KeyedCollection);

    function Record(defaultValues, name) {
      var hasInitialized;

      var RecordType = function Record(values) {
        if (values instanceof RecordType) {
          return values;
        }
        if (!(this instanceof RecordType)) {
          return new RecordType(values);
        }
        if (!hasInitialized) {
          hasInitialized = true;
          var keys = Object.keys(defaultValues);
          setProps(RecordTypePrototype, keys);
          RecordTypePrototype.size = keys.length;
          RecordTypePrototype._name = name;
          RecordTypePrototype._keys = keys;
          RecordTypePrototype._defaultValues = defaultValues;
        }
        this._map = Map(values);
      };

      var RecordTypePrototype = RecordType.prototype = Object.create(RecordPrototype);
      RecordTypePrototype.constructor = RecordType;

      return RecordType;
    }

    Record.prototype.toString = function() {
      return this.__toString(recordName(this) + ' {', '}');
    };

    // @pragma Access

    Record.prototype.has = function(k) {
      return this._defaultValues.hasOwnProperty(k);
    };

    Record.prototype.get = function(k, notSetValue) {
      if (!this.has(k)) {
        return notSetValue;
      }
      var defaultVal = this._defaultValues[k];
      return this._map ? this._map.get(k, defaultVal) : defaultVal;
    };

    // @pragma Modification

    Record.prototype.clear = function() {
      if (this.__ownerID) {
        this._map && this._map.clear();
        return this;
      }
      var RecordType = this.constructor;
      return RecordType._empty || (RecordType._empty = makeRecord(this, emptyMap()));
    };

    Record.prototype.set = function(k, v) {
      if (!this.has(k)) {
        throw new Error('Cannot set unknown key "' + k + '" on ' + recordName(this));
      }
      if (this._map && !this._map.has(k)) {
        var defaultVal = this._defaultValues[k];
        if (v === defaultVal) {
          return this;
        }
      }
      var newMap = this._map && this._map.set(k, v);
      if (this.__ownerID || newMap === this._map) {
        return this;
      }
      return makeRecord(this, newMap);
    };

    Record.prototype.remove = function(k) {
      if (!this.has(k)) {
        return this;
      }
      var newMap = this._map && this._map.remove(k);
      if (this.__ownerID || newMap === this._map) {
        return this;
      }
      return makeRecord(this, newMap);
    };

    Record.prototype.wasAltered = function() {
      return this._map.wasAltered();
    };

    Record.prototype.__iterator = function(type, reverse) {var this$0 = this;
      return KeyedIterable(this._defaultValues).map(function(_, k)  {return this$0.get(k)}).__iterator(type, reverse);
    };

    Record.prototype.__iterate = function(fn, reverse) {var this$0 = this;
      return KeyedIterable(this._defaultValues).map(function(_, k)  {return this$0.get(k)}).__iterate(fn, reverse);
    };

    Record.prototype.__ensureOwner = function(ownerID) {
      if (ownerID === this.__ownerID) {
        return this;
      }
      var newMap = this._map && this._map.__ensureOwner(ownerID);
      if (!ownerID) {
        this.__ownerID = ownerID;
        this._map = newMap;
        return this;
      }
      return makeRecord(this, newMap, ownerID);
    };


  var RecordPrototype = Record.prototype;
  RecordPrototype[DELETE] = RecordPrototype.remove;
  RecordPrototype.deleteIn =
  RecordPrototype.removeIn = MapPrototype.removeIn;
  RecordPrototype.merge = MapPrototype.merge;
  RecordPrototype.mergeWith = MapPrototype.mergeWith;
  RecordPrototype.mergeIn = MapPrototype.mergeIn;
  RecordPrototype.mergeDeep = MapPrototype.mergeDeep;
  RecordPrototype.mergeDeepWith = MapPrototype.mergeDeepWith;
  RecordPrototype.mergeDeepIn = MapPrototype.mergeDeepIn;
  RecordPrototype.setIn = MapPrototype.setIn;
  RecordPrototype.update = MapPrototype.update;
  RecordPrototype.updateIn = MapPrototype.updateIn;
  RecordPrototype.withMutations = MapPrototype.withMutations;
  RecordPrototype.asMutable = MapPrototype.asMutable;
  RecordPrototype.asImmutable = MapPrototype.asImmutable;


  function makeRecord(likeRecord, map, ownerID) {
    var record = Object.create(Object.getPrototypeOf(likeRecord));
    record._map = map;
    record.__ownerID = ownerID;
    return record;
  }

  function recordName(record) {
    return record._name || record.constructor.name || 'Record';
  }

  function setProps(prototype, names) {
    try {
      names.forEach(setProp.bind(undefined, prototype));
    } catch (error) {
      // Object.defineProperty failed. Probably IE8.
    }
  }

  function setProp(prototype, name) {
    Object.defineProperty(prototype, name, {
      get: function() {
        return this.get(name);
      },
      set: function(value) {
        invariant(this.__ownerID, 'Cannot set on an immutable record.');
        this.set(name, value);
      }
    });
  }

  createClass(Set, SetCollection);

    // @pragma Construction

    function Set(value) {
      return value === null || value === undefined ? emptySet() :
        isSet(value) && !isOrdered(value) ? value :
        emptySet().withMutations(function(set ) {
          var iter = SetIterable(value);
          assertNotInfinite(iter.size);
          iter.forEach(function(v ) {return set.add(v)});
        });
    }

    Set.of = function(/*...values*/) {
      return this(arguments);
    };

    Set.fromKeys = function(value) {
      return this(KeyedIterable(value).keySeq());
    };

    Set.prototype.toString = function() {
      return this.__toString('Set {', '}');
    };

    // @pragma Access

    Set.prototype.has = function(value) {
      return this._map.has(value);
    };

    // @pragma Modification

    Set.prototype.add = function(value) {
      return updateSet(this, this._map.set(value, true));
    };

    Set.prototype.remove = function(value) {
      return updateSet(this, this._map.remove(value));
    };

    Set.prototype.clear = function() {
      return updateSet(this, this._map.clear());
    };

    // @pragma Composition

    Set.prototype.union = function() {var iters = SLICE$0.call(arguments, 0);
      iters = iters.filter(function(x ) {return x.size !== 0});
      if (iters.length === 0) {
        return this;
      }
      if (this.size === 0 && !this.__ownerID && iters.length === 1) {
        return this.constructor(iters[0]);
      }
      return this.withMutations(function(set ) {
        for (var ii = 0; ii < iters.length; ii++) {
          SetIterable(iters[ii]).forEach(function(value ) {return set.add(value)});
        }
      });
    };

    Set.prototype.intersect = function() {var iters = SLICE$0.call(arguments, 0);
      if (iters.length === 0) {
        return this;
      }
      iters = iters.map(function(iter ) {return SetIterable(iter)});
      var originalSet = this;
      return this.withMutations(function(set ) {
        originalSet.forEach(function(value ) {
          if (!iters.every(function(iter ) {return iter.includes(value)})) {
            set.remove(value);
          }
        });
      });
    };

    Set.prototype.subtract = function() {var iters = SLICE$0.call(arguments, 0);
      if (iters.length === 0) {
        return this;
      }
      iters = iters.map(function(iter ) {return SetIterable(iter)});
      var originalSet = this;
      return this.withMutations(function(set ) {
        originalSet.forEach(function(value ) {
          if (iters.some(function(iter ) {return iter.includes(value)})) {
            set.remove(value);
          }
        });
      });
    };

    Set.prototype.merge = function() {
      return this.union.apply(this, arguments);
    };

    Set.prototype.mergeWith = function(merger) {var iters = SLICE$0.call(arguments, 1);
      return this.union.apply(this, iters);
    };

    Set.prototype.sort = function(comparator) {
      // Late binding
      return OrderedSet(sortFactory(this, comparator));
    };

    Set.prototype.sortBy = function(mapper, comparator) {
      // Late binding
      return OrderedSet(sortFactory(this, comparator, mapper));
    };

    Set.prototype.wasAltered = function() {
      return this._map.wasAltered();
    };

    Set.prototype.__iterate = function(fn, reverse) {var this$0 = this;
      return this._map.__iterate(function(_, k)  {return fn(k, k, this$0)}, reverse);
    };

    Set.prototype.__iterator = function(type, reverse) {
      return this._map.map(function(_, k)  {return k}).__iterator(type, reverse);
    };

    Set.prototype.__ensureOwner = function(ownerID) {
      if (ownerID === this.__ownerID) {
        return this;
      }
      var newMap = this._map.__ensureOwner(ownerID);
      if (!ownerID) {
        this.__ownerID = ownerID;
        this._map = newMap;
        return this;
      }
      return this.__make(newMap, ownerID);
    };


  function isSet(maybeSet) {
    return !!(maybeSet && maybeSet[IS_SET_SENTINEL]);
  }

  Set.isSet = isSet;

  var IS_SET_SENTINEL = '@@__IMMUTABLE_SET__@@';

  var SetPrototype = Set.prototype;
  SetPrototype[IS_SET_SENTINEL] = true;
  SetPrototype[DELETE] = SetPrototype.remove;
  SetPrototype.mergeDeep = SetPrototype.merge;
  SetPrototype.mergeDeepWith = SetPrototype.mergeWith;
  SetPrototype.withMutations = MapPrototype.withMutations;
  SetPrototype.asMutable = MapPrototype.asMutable;
  SetPrototype.asImmutable = MapPrototype.asImmutable;

  SetPrototype.__empty = emptySet;
  SetPrototype.__make = makeSet;

  function updateSet(set, newMap) {
    if (set.__ownerID) {
      set.size = newMap.size;
      set._map = newMap;
      return set;
    }
    return newMap === set._map ? set :
      newMap.size === 0 ? set.__empty() :
      set.__make(newMap);
  }

  function makeSet(map, ownerID) {
    var set = Object.create(SetPrototype);
    set.size = map ? map.size : 0;
    set._map = map;
    set.__ownerID = ownerID;
    return set;
  }

  var EMPTY_SET;
  function emptySet() {
    return EMPTY_SET || (EMPTY_SET = makeSet(emptyMap()));
  }

  createClass(OrderedSet, Set);

    // @pragma Construction

    function OrderedSet(value) {
      return value === null || value === undefined ? emptyOrderedSet() :
        isOrderedSet(value) ? value :
        emptyOrderedSet().withMutations(function(set ) {
          var iter = SetIterable(value);
          assertNotInfinite(iter.size);
          iter.forEach(function(v ) {return set.add(v)});
        });
    }

    OrderedSet.of = function(/*...values*/) {
      return this(arguments);
    };

    OrderedSet.fromKeys = function(value) {
      return this(KeyedIterable(value).keySeq());
    };

    OrderedSet.prototype.toString = function() {
      return this.__toString('OrderedSet {', '}');
    };


  function isOrderedSet(maybeOrderedSet) {
    return isSet(maybeOrderedSet) && isOrdered(maybeOrderedSet);
  }

  OrderedSet.isOrderedSet = isOrderedSet;

  var OrderedSetPrototype = OrderedSet.prototype;
  OrderedSetPrototype[IS_ORDERED_SENTINEL] = true;

  OrderedSetPrototype.__empty = emptyOrderedSet;
  OrderedSetPrototype.__make = makeOrderedSet;

  function makeOrderedSet(map, ownerID) {
    var set = Object.create(OrderedSetPrototype);
    set.size = map ? map.size : 0;
    set._map = map;
    set.__ownerID = ownerID;
    return set;
  }

  var EMPTY_ORDERED_SET;
  function emptyOrderedSet() {
    return EMPTY_ORDERED_SET || (EMPTY_ORDERED_SET = makeOrderedSet(emptyOrderedMap()));
  }

  createClass(Stack, IndexedCollection);

    // @pragma Construction

    function Stack(value) {
      return value === null || value === undefined ? emptyStack() :
        isStack(value) ? value :
        emptyStack().unshiftAll(value);
    }

    Stack.of = function(/*...values*/) {
      return this(arguments);
    };

    Stack.prototype.toString = function() {
      return this.__toString('Stack [', ']');
    };

    // @pragma Access

    Stack.prototype.get = function(index, notSetValue) {
      var head = this._head;
      index = wrapIndex(this, index);
      while (head && index--) {
        head = head.next;
      }
      return head ? head.value : notSetValue;
    };

    Stack.prototype.peek = function() {
      return this._head && this._head.value;
    };

    // @pragma Modification

    Stack.prototype.push = function(/*...values*/) {
      if (arguments.length === 0) {
        return this;
      }
      var newSize = this.size + arguments.length;
      var head = this._head;
      for (var ii = arguments.length - 1; ii >= 0; ii--) {
        head = {
          value: arguments[ii],
          next: head
        };
      }
      if (this.__ownerID) {
        this.size = newSize;
        this._head = head;
        this.__hash = undefined;
        this.__altered = true;
        return this;
      }
      return makeStack(newSize, head);
    };

    Stack.prototype.pushAll = function(iter) {
      iter = IndexedIterable(iter);
      if (iter.size === 0) {
        return this;
      }
      assertNotInfinite(iter.size);
      var newSize = this.size;
      var head = this._head;
      iter.reverse().forEach(function(value ) {
        newSize++;
        head = {
          value: value,
          next: head
        };
      });
      if (this.__ownerID) {
        this.size = newSize;
        this._head = head;
        this.__hash = undefined;
        this.__altered = true;
        return this;
      }
      return makeStack(newSize, head);
    };

    Stack.prototype.pop = function() {
      return this.slice(1);
    };

    Stack.prototype.unshift = function(/*...values*/) {
      return this.push.apply(this, arguments);
    };

    Stack.prototype.unshiftAll = function(iter) {
      return this.pushAll(iter);
    };

    Stack.prototype.shift = function() {
      return this.pop.apply(this, arguments);
    };

    Stack.prototype.clear = function() {
      if (this.size === 0) {
        return this;
      }
      if (this.__ownerID) {
        this.size = 0;
        this._head = undefined;
        this.__hash = undefined;
        this.__altered = true;
        return this;
      }
      return emptyStack();
    };

    Stack.prototype.slice = function(begin, end) {
      if (wholeSlice(begin, end, this.size)) {
        return this;
      }
      var resolvedBegin = resolveBegin(begin, this.size);
      var resolvedEnd = resolveEnd(end, this.size);
      if (resolvedEnd !== this.size) {
        // super.slice(begin, end);
        return IndexedCollection.prototype.slice.call(this, begin, end);
      }
      var newSize = this.size - resolvedBegin;
      var head = this._head;
      while (resolvedBegin--) {
        head = head.next;
      }
      if (this.__ownerID) {
        this.size = newSize;
        this._head = head;
        this.__hash = undefined;
        this.__altered = true;
        return this;
      }
      return makeStack(newSize, head);
    };

    // @pragma Mutability

    Stack.prototype.__ensureOwner = function(ownerID) {
      if (ownerID === this.__ownerID) {
        return this;
      }
      if (!ownerID) {
        this.__ownerID = ownerID;
        this.__altered = false;
        return this;
      }
      return makeStack(this.size, this._head, ownerID, this.__hash);
    };

    // @pragma Iteration

    Stack.prototype.__iterate = function(fn, reverse) {
      if (reverse) {
        return this.reverse().__iterate(fn);
      }
      var iterations = 0;
      var node = this._head;
      while (node) {
        if (fn(node.value, iterations++, this) === false) {
          break;
        }
        node = node.next;
      }
      return iterations;
    };

    Stack.prototype.__iterator = function(type, reverse) {
      if (reverse) {
        return this.reverse().__iterator(type);
      }
      var iterations = 0;
      var node = this._head;
      return new Iterator(function()  {
        if (node) {
          var value = node.value;
          node = node.next;
          return iteratorValue(type, iterations++, value);
        }
        return iteratorDone();
      });
    };


  function isStack(maybeStack) {
    return !!(maybeStack && maybeStack[IS_STACK_SENTINEL]);
  }

  Stack.isStack = isStack;

  var IS_STACK_SENTINEL = '@@__IMMUTABLE_STACK__@@';

  var StackPrototype = Stack.prototype;
  StackPrototype[IS_STACK_SENTINEL] = true;
  StackPrototype.withMutations = MapPrototype.withMutations;
  StackPrototype.asMutable = MapPrototype.asMutable;
  StackPrototype.asImmutable = MapPrototype.asImmutable;
  StackPrototype.wasAltered = MapPrototype.wasAltered;


  function makeStack(size, head, ownerID, hash) {
    var map = Object.create(StackPrototype);
    map.size = size;
    map._head = head;
    map.__ownerID = ownerID;
    map.__hash = hash;
    map.__altered = false;
    return map;
  }

  var EMPTY_STACK;
  function emptyStack() {
    return EMPTY_STACK || (EMPTY_STACK = makeStack(0));
  }

  /**
   * Contributes additional methods to a constructor
   */
  function mixin(ctor, methods) {
    var keyCopier = function(key ) { ctor.prototype[key] = methods[key]; };
    Object.keys(methods).forEach(keyCopier);
    Object.getOwnPropertySymbols &&
      Object.getOwnPropertySymbols(methods).forEach(keyCopier);
    return ctor;
  }

  Iterable.Iterator = Iterator;

  mixin(Iterable, {

    // ### Conversion to other types

    toArray: function() {
      assertNotInfinite(this.size);
      var array = new Array(this.size || 0);
      this.valueSeq().__iterate(function(v, i)  { array[i] = v; });
      return array;
    },

    toIndexedSeq: function() {
      return new ToIndexedSequence(this);
    },

    toJS: function() {
      return this.toSeq().map(
        function(value ) {return value && typeof value.toJS === 'function' ? value.toJS() : value}
      ).__toJS();
    },

    toJSON: function() {
      return this.toSeq().map(
        function(value ) {return value && typeof value.toJSON === 'function' ? value.toJSON() : value}
      ).__toJS();
    },

    toKeyedSeq: function() {
      return new ToKeyedSequence(this, true);
    },

    toMap: function() {
      // Use Late Binding here to solve the circular dependency.
      return Map(this.toKeyedSeq());
    },

    toObject: function() {
      assertNotInfinite(this.size);
      var object = {};
      this.__iterate(function(v, k)  { object[k] = v; });
      return object;
    },

    toOrderedMap: function() {
      // Use Late Binding here to solve the circular dependency.
      return OrderedMap(this.toKeyedSeq());
    },

    toOrderedSet: function() {
      // Use Late Binding here to solve the circular dependency.
      return OrderedSet(isKeyed(this) ? this.valueSeq() : this);
    },

    toSet: function() {
      // Use Late Binding here to solve the circular dependency.
      return Set(isKeyed(this) ? this.valueSeq() : this);
    },

    toSetSeq: function() {
      return new ToSetSequence(this);
    },

    toSeq: function() {
      return isIndexed(this) ? this.toIndexedSeq() :
        isKeyed(this) ? this.toKeyedSeq() :
        this.toSetSeq();
    },

    toStack: function() {
      // Use Late Binding here to solve the circular dependency.
      return Stack(isKeyed(this) ? this.valueSeq() : this);
    },

    toList: function() {
      // Use Late Binding here to solve the circular dependency.
      return List(isKeyed(this) ? this.valueSeq() : this);
    },


    // ### Common JavaScript methods and properties

    toString: function() {
      return '[Iterable]';
    },

    __toString: function(head, tail) {
      if (this.size === 0) {
        return head + tail;
      }
      return head + ' ' + this.toSeq().map(this.__toStringMapper).join(', ') + ' ' + tail;
    },


    // ### ES6 Collection methods (ES6 Array and Map)

    concat: function() {var values = SLICE$0.call(arguments, 0);
      return reify(this, concatFactory(this, values));
    },

    includes: function(searchValue) {
      return this.some(function(value ) {return is(value, searchValue)});
    },

    entries: function() {
      return this.__iterator(ITERATE_ENTRIES);
    },

    every: function(predicate, context) {
      assertNotInfinite(this.size);
      var returnValue = true;
      this.__iterate(function(v, k, c)  {
        if (!predicate.call(context, v, k, c)) {
          returnValue = false;
          return false;
        }
      });
      return returnValue;
    },

    filter: function(predicate, context) {
      return reify(this, filterFactory(this, predicate, context, true));
    },

    find: function(predicate, context, notSetValue) {
      var entry = this.findEntry(predicate, context);
      return entry ? entry[1] : notSetValue;
    },

    forEach: function(sideEffect, context) {
      assertNotInfinite(this.size);
      return this.__iterate(context ? sideEffect.bind(context) : sideEffect);
    },

    join: function(separator) {
      assertNotInfinite(this.size);
      separator = separator !== undefined ? '' + separator : ',';
      var joined = '';
      var isFirst = true;
      this.__iterate(function(v ) {
        isFirst ? (isFirst = false) : (joined += separator);
        joined += v !== null && v !== undefined ? v.toString() : '';
      });
      return joined;
    },

    keys: function() {
      return this.__iterator(ITERATE_KEYS);
    },

    map: function(mapper, context) {
      return reify(this, mapFactory(this, mapper, context));
    },

    reduce: function(reducer, initialReduction, context) {
      assertNotInfinite(this.size);
      var reduction;
      var useFirst;
      if (arguments.length < 2) {
        useFirst = true;
      } else {
        reduction = initialReduction;
      }
      this.__iterate(function(v, k, c)  {
        if (useFirst) {
          useFirst = false;
          reduction = v;
        } else {
          reduction = reducer.call(context, reduction, v, k, c);
        }
      });
      return reduction;
    },

    reduceRight: function(reducer, initialReduction, context) {
      var reversed = this.toKeyedSeq().reverse();
      return reversed.reduce.apply(reversed, arguments);
    },

    reverse: function() {
      return reify(this, reverseFactory(this, true));
    },

    slice: function(begin, end) {
      return reify(this, sliceFactory(this, begin, end, true));
    },

    some: function(predicate, context) {
      return !this.every(not(predicate), context);
    },

    sort: function(comparator) {
      return reify(this, sortFactory(this, comparator));
    },

    values: function() {
      return this.__iterator(ITERATE_VALUES);
    },


    // ### More sequential methods

    butLast: function() {
      return this.slice(0, -1);
    },

    isEmpty: function() {
      return this.size !== undefined ? this.size === 0 : !this.some(function()  {return true});
    },

    count: function(predicate, context) {
      return ensureSize(
        predicate ? this.toSeq().filter(predicate, context) : this
      );
    },

    countBy: function(grouper, context) {
      return countByFactory(this, grouper, context);
    },

    equals: function(other) {
      return deepEqual(this, other);
    },

    entrySeq: function() {
      var iterable = this;
      if (iterable._cache) {
        // We cache as an entries array, so we can just return the cache!
        return new ArraySeq(iterable._cache);
      }
      var entriesSequence = iterable.toSeq().map(entryMapper).toIndexedSeq();
      entriesSequence.fromEntrySeq = function()  {return iterable.toSeq()};
      return entriesSequence;
    },

    filterNot: function(predicate, context) {
      return this.filter(not(predicate), context);
    },

    findEntry: function(predicate, context, notSetValue) {
      var found = notSetValue;
      this.__iterate(function(v, k, c)  {
        if (predicate.call(context, v, k, c)) {
          found = [k, v];
          return false;
        }
      });
      return found;
    },

    findKey: function(predicate, context) {
      var entry = this.findEntry(predicate, context);
      return entry && entry[0];
    },

    findLast: function(predicate, context, notSetValue) {
      return this.toKeyedSeq().reverse().find(predicate, context, notSetValue);
    },

    findLastEntry: function(predicate, context, notSetValue) {
      return this.toKeyedSeq().reverse().findEntry(predicate, context, notSetValue);
    },

    findLastKey: function(predicate, context) {
      return this.toKeyedSeq().reverse().findKey(predicate, context);
    },

    first: function() {
      return this.find(returnTrue);
    },

    flatMap: function(mapper, context) {
      return reify(this, flatMapFactory(this, mapper, context));
    },

    flatten: function(depth) {
      return reify(this, flattenFactory(this, depth, true));
    },

    fromEntrySeq: function() {
      return new FromEntriesSequence(this);
    },

    get: function(searchKey, notSetValue) {
      return this.find(function(_, key)  {return is(key, searchKey)}, undefined, notSetValue);
    },

    getIn: function(searchKeyPath, notSetValue) {
      var nested = this;
      // Note: in an ES6 environment, we would prefer:
      // for (var key of searchKeyPath) {
      var iter = forceIterator(searchKeyPath);
      var step;
      while (!(step = iter.next()).done) {
        var key = step.value;
        nested = nested && nested.get ? nested.get(key, NOT_SET) : NOT_SET;
        if (nested === NOT_SET) {
          return notSetValue;
        }
      }
      return nested;
    },

    groupBy: function(grouper, context) {
      return groupByFactory(this, grouper, context);
    },

    has: function(searchKey) {
      return this.get(searchKey, NOT_SET) !== NOT_SET;
    },

    hasIn: function(searchKeyPath) {
      return this.getIn(searchKeyPath, NOT_SET) !== NOT_SET;
    },

    isSubset: function(iter) {
      iter = typeof iter.includes === 'function' ? iter : Iterable(iter);
      return this.every(function(value ) {return iter.includes(value)});
    },

    isSuperset: function(iter) {
      iter = typeof iter.isSubset === 'function' ? iter : Iterable(iter);
      return iter.isSubset(this);
    },

    keyOf: function(searchValue) {
      return this.findKey(function(value ) {return is(value, searchValue)});
    },

    keySeq: function() {
      return this.toSeq().map(keyMapper).toIndexedSeq();
    },

    last: function() {
      return this.toSeq().reverse().first();
    },

    lastKeyOf: function(searchValue) {
      return this.toKeyedSeq().reverse().keyOf(searchValue);
    },

    max: function(comparator) {
      return maxFactory(this, comparator);
    },

    maxBy: function(mapper, comparator) {
      return maxFactory(this, comparator, mapper);
    },

    min: function(comparator) {
      return maxFactory(this, comparator ? neg(comparator) : defaultNegComparator);
    },

    minBy: function(mapper, comparator) {
      return maxFactory(this, comparator ? neg(comparator) : defaultNegComparator, mapper);
    },

    rest: function() {
      return this.slice(1);
    },

    skip: function(amount) {
      return this.slice(Math.max(0, amount));
    },

    skipLast: function(amount) {
      return reify(this, this.toSeq().reverse().skip(amount).reverse());
    },

    skipWhile: function(predicate, context) {
      return reify(this, skipWhileFactory(this, predicate, context, true));
    },

    skipUntil: function(predicate, context) {
      return this.skipWhile(not(predicate), context);
    },

    sortBy: function(mapper, comparator) {
      return reify(this, sortFactory(this, comparator, mapper));
    },

    take: function(amount) {
      return this.slice(0, Math.max(0, amount));
    },

    takeLast: function(amount) {
      return reify(this, this.toSeq().reverse().take(amount).reverse());
    },

    takeWhile: function(predicate, context) {
      return reify(this, takeWhileFactory(this, predicate, context));
    },

    takeUntil: function(predicate, context) {
      return this.takeWhile(not(predicate), context);
    },

    valueSeq: function() {
      return this.toIndexedSeq();
    },


    // ### Hashable Object

    hashCode: function() {
      return this.__hash || (this.__hash = hashIterable(this));
    }


    // ### Internal

    // abstract __iterate(fn, reverse)

    // abstract __iterator(type, reverse)
  });

  // var IS_ITERABLE_SENTINEL = '@@__IMMUTABLE_ITERABLE__@@';
  // var IS_KEYED_SENTINEL = '@@__IMMUTABLE_KEYED__@@';
  // var IS_INDEXED_SENTINEL = '@@__IMMUTABLE_INDEXED__@@';
  // var IS_ORDERED_SENTINEL = '@@__IMMUTABLE_ORDERED__@@';

  var IterablePrototype = Iterable.prototype;
  IterablePrototype[IS_ITERABLE_SENTINEL] = true;
  IterablePrototype[ITERATOR_SYMBOL] = IterablePrototype.values;
  IterablePrototype.__toJS = IterablePrototype.toArray;
  IterablePrototype.__toStringMapper = quoteString;
  IterablePrototype.inspect =
  IterablePrototype.toSource = function() { return this.toString(); };
  IterablePrototype.chain = IterablePrototype.flatMap;
  IterablePrototype.contains = IterablePrototype.includes;

  mixin(KeyedIterable, {

    // ### More sequential methods

    flip: function() {
      return reify(this, flipFactory(this));
    },

    mapEntries: function(mapper, context) {var this$0 = this;
      var iterations = 0;
      return reify(this,
        this.toSeq().map(
          function(v, k)  {return mapper.call(context, [k, v], iterations++, this$0)}
        ).fromEntrySeq()
      );
    },

    mapKeys: function(mapper, context) {var this$0 = this;
      return reify(this,
        this.toSeq().flip().map(
          function(k, v)  {return mapper.call(context, k, v, this$0)}
        ).flip()
      );
    }

  });

  var KeyedIterablePrototype = KeyedIterable.prototype;
  KeyedIterablePrototype[IS_KEYED_SENTINEL] = true;
  KeyedIterablePrototype[ITERATOR_SYMBOL] = IterablePrototype.entries;
  KeyedIterablePrototype.__toJS = IterablePrototype.toObject;
  KeyedIterablePrototype.__toStringMapper = function(v, k)  {return JSON.stringify(k) + ': ' + quoteString(v)};



  mixin(IndexedIterable, {

    // ### Conversion to other types

    toKeyedSeq: function() {
      return new ToKeyedSequence(this, false);
    },


    // ### ES6 Collection methods (ES6 Array and Map)

    filter: function(predicate, context) {
      return reify(this, filterFactory(this, predicate, context, false));
    },

    findIndex: function(predicate, context) {
      var entry = this.findEntry(predicate, context);
      return entry ? entry[0] : -1;
    },

    indexOf: function(searchValue) {
      var key = this.keyOf(searchValue);
      return key === undefined ? -1 : key;
    },

    lastIndexOf: function(searchValue) {
      var key = this.lastKeyOf(searchValue);
      return key === undefined ? -1 : key;
    },

    reverse: function() {
      return reify(this, reverseFactory(this, false));
    },

    slice: function(begin, end) {
      return reify(this, sliceFactory(this, begin, end, false));
    },

    splice: function(index, removeNum /*, ...values*/) {
      var numArgs = arguments.length;
      removeNum = Math.max(removeNum | 0, 0);
      if (numArgs === 0 || (numArgs === 2 && !removeNum)) {
        return this;
      }
      // If index is negative, it should resolve relative to the size of the
      // collection. However size may be expensive to compute if not cached, so
      // only call count() if the number is in fact negative.
      index = resolveBegin(index, index < 0 ? this.count() : this.size);
      var spliced = this.slice(0, index);
      return reify(
        this,
        numArgs === 1 ?
          spliced :
          spliced.concat(arrCopy(arguments, 2), this.slice(index + removeNum))
      );
    },


    // ### More collection methods

    findLastIndex: function(predicate, context) {
      var entry = this.findLastEntry(predicate, context);
      return entry ? entry[0] : -1;
    },

    first: function() {
      return this.get(0);
    },

    flatten: function(depth) {
      return reify(this, flattenFactory(this, depth, false));
    },

    get: function(index, notSetValue) {
      index = wrapIndex(this, index);
      return (index < 0 || (this.size === Infinity ||
          (this.size !== undefined && index > this.size))) ?
        notSetValue :
        this.find(function(_, key)  {return key === index}, undefined, notSetValue);
    },

    has: function(index) {
      index = wrapIndex(this, index);
      return index >= 0 && (this.size !== undefined ?
        this.size === Infinity || index < this.size :
        this.indexOf(index) !== -1
      );
    },

    interpose: function(separator) {
      return reify(this, interposeFactory(this, separator));
    },

    interleave: function(/*...iterables*/) {
      var iterables = [this].concat(arrCopy(arguments));
      var zipped = zipWithFactory(this.toSeq(), IndexedSeq.of, iterables);
      var interleaved = zipped.flatten(true);
      if (zipped.size) {
        interleaved.size = zipped.size * iterables.length;
      }
      return reify(this, interleaved);
    },

    keySeq: function() {
      return Range(0, this.size);
    },

    last: function() {
      return this.get(-1);
    },

    skipWhile: function(predicate, context) {
      return reify(this, skipWhileFactory(this, predicate, context, false));
    },

    zip: function(/*, ...iterables */) {
      var iterables = [this].concat(arrCopy(arguments));
      return reify(this, zipWithFactory(this, defaultZipper, iterables));
    },

    zipWith: function(zipper/*, ...iterables */) {
      var iterables = arrCopy(arguments);
      iterables[0] = this;
      return reify(this, zipWithFactory(this, zipper, iterables));
    }

  });

  IndexedIterable.prototype[IS_INDEXED_SENTINEL] = true;
  IndexedIterable.prototype[IS_ORDERED_SENTINEL] = true;



  mixin(SetIterable, {

    // ### ES6 Collection methods (ES6 Array and Map)

    get: function(value, notSetValue) {
      return this.has(value) ? value : notSetValue;
    },

    includes: function(value) {
      return this.has(value);
    },


    // ### More sequential methods

    keySeq: function() {
      return this.valueSeq();
    }

  });

  SetIterable.prototype.has = IterablePrototype.includes;
  SetIterable.prototype.contains = SetIterable.prototype.includes;


  // Mixin subclasses

  mixin(KeyedSeq, KeyedIterable.prototype);
  mixin(IndexedSeq, IndexedIterable.prototype);
  mixin(SetSeq, SetIterable.prototype);

  mixin(KeyedCollection, KeyedIterable.prototype);
  mixin(IndexedCollection, IndexedIterable.prototype);
  mixin(SetCollection, SetIterable.prototype);


  // #pragma Helper functions

  function keyMapper(v, k) {
    return k;
  }

  function entryMapper(v, k) {
    return [k, v];
  }

  function not(predicate) {
    return function() {
      return !predicate.apply(this, arguments);
    }
  }

  function neg(predicate) {
    return function() {
      return -predicate.apply(this, arguments);
    }
  }

  function quoteString(value) {
    return typeof value === 'string' ? JSON.stringify(value) : String(value);
  }

  function defaultZipper() {
    return arrCopy(arguments);
  }

  function defaultNegComparator(a, b) {
    return a < b ? 1 : a > b ? -1 : 0;
  }

  function hashIterable(iterable) {
    if (iterable.size === Infinity) {
      return 0;
    }
    var ordered = isOrdered(iterable);
    var keyed = isKeyed(iterable);
    var h = ordered ? 1 : 0;
    var size = iterable.__iterate(
      keyed ?
        ordered ?
          function(v, k)  { h = 31 * h + hashMerge(hash(v), hash(k)) | 0; } :
          function(v, k)  { h = h + hashMerge(hash(v), hash(k)) | 0; } :
        ordered ?
          function(v ) { h = 31 * h + hash(v) | 0; } :
          function(v ) { h = h + hash(v) | 0; }
    );
    return murmurHashOfSize(size, h);
  }

  function murmurHashOfSize(size, h) {
    h = imul(h, 0xCC9E2D51);
    h = imul(h << 15 | h >>> -15, 0x1B873593);
    h = imul(h << 13 | h >>> -13, 5);
    h = (h + 0xE6546B64 | 0) ^ size;
    h = imul(h ^ h >>> 16, 0x85EBCA6B);
    h = imul(h ^ h >>> 13, 0xC2B2AE35);
    h = smi(h ^ h >>> 16);
    return h;
  }

  function hashMerge(a, b) {
    return a ^ b + 0x9E3779B9 + (a << 6) + (a >> 2) | 0; // int
  }

  var Immutable = {

    Iterable: Iterable,

    Seq: Seq,
    Collection: Collection,
    Map: Map,
    OrderedMap: OrderedMap,
    List: List,
    Stack: Stack,
    Set: Set,
    OrderedSet: OrderedSet,

    Record: Record,
    Range: Range,
    Repeat: Repeat,

    is: is,
    fromJS: fromJS

  };

  return Immutable;

}));

/***/ }),

/***/ "./node_modules/pako/index.js":
/*!************************************!*\
  !*** ./node_modules/pako/index.js ***!
  \************************************/
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";
// Top level file is just a mixin of submodules & constants


const { Deflate, deflate, deflateRaw, gzip } = __webpack_require__(/*! ./lib/deflate */ "./node_modules/pako/lib/deflate.js");

const { Inflate, inflate, inflateRaw, ungzip } = __webpack_require__(/*! ./lib/inflate */ "./node_modules/pako/lib/inflate.js");

const constants = __webpack_require__(/*! ./lib/zlib/constants */ "./node_modules/pako/lib/zlib/constants.js");

module.exports.Deflate = Deflate;
module.exports.deflate = deflate;
module.exports.deflateRaw = deflateRaw;
module.exports.gzip = gzip;
module.exports.Inflate = Inflate;
module.exports.inflate = inflate;
module.exports.inflateRaw = inflateRaw;
module.exports.ungzip = ungzip;
module.exports.constants = constants;


/***/ }),

/***/ "./node_modules/pako/lib/deflate.js":
/*!******************************************!*\
  !*** ./node_modules/pako/lib/deflate.js ***!
  \******************************************/
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";



const zlib_deflate = __webpack_require__(/*! ./zlib/deflate */ "./node_modules/pako/lib/zlib/deflate.js");
const utils        = __webpack_require__(/*! ./utils/common */ "./node_modules/pako/lib/utils/common.js");
const strings      = __webpack_require__(/*! ./utils/strings */ "./node_modules/pako/lib/utils/strings.js");
const msg          = __webpack_require__(/*! ./zlib/messages */ "./node_modules/pako/lib/zlib/messages.js");
const ZStream      = __webpack_require__(/*! ./zlib/zstream */ "./node_modules/pako/lib/zlib/zstream.js");

const toString = Object.prototype.toString;

/* Public constants ==========================================================*/
/* ===========================================================================*/

const {
  Z_NO_FLUSH, Z_SYNC_FLUSH, Z_FULL_FLUSH, Z_FINISH,
  Z_OK, Z_STREAM_END,
  Z_DEFAULT_COMPRESSION,
  Z_DEFAULT_STRATEGY,
  Z_DEFLATED
} = __webpack_require__(/*! ./zlib/constants */ "./node_modules/pako/lib/zlib/constants.js");

/* ===========================================================================*/


/**
 * class Deflate
 *
 * Generic JS-style wrapper for zlib calls. If you don't need
 * streaming behaviour - use more simple functions: [[deflate]],
 * [[deflateRaw]] and [[gzip]].
 **/

/* internal
 * Deflate.chunks -> Array
 *
 * Chunks of output data, if [[Deflate#onData]] not overridden.
 **/

/**
 * Deflate.result -> Uint8Array
 *
 * Compressed result, generated by default [[Deflate#onData]]
 * and [[Deflate#onEnd]] handlers. Filled after you push last chunk
 * (call [[Deflate#push]] with `Z_FINISH` / `true` param).
 **/

/**
 * Deflate.err -> Number
 *
 * Error code after deflate finished. 0 (Z_OK) on success.
 * You will not need it in real life, because deflate errors
 * are possible only on wrong options or bad `onData` / `onEnd`
 * custom handlers.
 **/

/**
 * Deflate.msg -> String
 *
 * Error message, if [[Deflate.err]] != 0
 **/


/**
 * new Deflate(options)
 * - options (Object): zlib deflate options.
 *
 * Creates new deflator instance with specified params. Throws exception
 * on bad params. Supported options:
 *
 * - `level`
 * - `windowBits`
 * - `memLevel`
 * - `strategy`
 * - `dictionary`
 *
 * [http://zlib.net/manual.html#Advanced](http://zlib.net/manual.html#Advanced)
 * for more information on these.
 *
 * Additional options, for internal needs:
 *
 * - `chunkSize` - size of generated data chunks (16K by default)
 * - `raw` (Boolean) - do raw deflate
 * - `gzip` (Boolean) - create gzip wrapper
 * - `header` (Object) - custom header for gzip
 *   - `text` (Boolean) - true if compressed data believed to be text
 *   - `time` (Number) - modification time, unix timestamp
 *   - `os` (Number) - operation system code
 *   - `extra` (Array) - array of bytes with extra data (max 65536)
 *   - `name` (String) - file name (binary string)
 *   - `comment` (String) - comment (binary string)
 *   - `hcrc` (Boolean) - true if header crc should be added
 *
 * ##### Example:
 *
 * ```javascript
 * const pako = require('pako')
 *   , chunk1 = new Uint8Array([1,2,3,4,5,6,7,8,9])
 *   , chunk2 = new Uint8Array([10,11,12,13,14,15,16,17,18,19]);
 *
 * const deflate = new pako.Deflate({ level: 3});
 *
 * deflate.push(chunk1, false);
 * deflate.push(chunk2, true);  // true -> last chunk
 *
 * if (deflate.err) { throw new Error(deflate.err); }
 *
 * console.log(deflate.result);
 * ```
 **/
function Deflate(options) {
  this.options = utils.assign({
    level: Z_DEFAULT_COMPRESSION,
    method: Z_DEFLATED,
    chunkSize: 16384,
    windowBits: 15,
    memLevel: 8,
    strategy: Z_DEFAULT_STRATEGY
  }, options || {});

  let opt = this.options;

  if (opt.raw && (opt.windowBits > 0)) {
    opt.windowBits = -opt.windowBits;
  }

  else if (opt.gzip && (opt.windowBits > 0) && (opt.windowBits < 16)) {
    opt.windowBits += 16;
  }

  this.err    = 0;      // error code, if happens (0 = Z_OK)
  this.msg    = '';     // error message
  this.ended  = false;  // used to avoid multiple onEnd() calls
  this.chunks = [];     // chunks of compressed data

  this.strm = new ZStream();
  this.strm.avail_out = 0;

  let status = zlib_deflate.deflateInit2(
    this.strm,
    opt.level,
    opt.method,
    opt.windowBits,
    opt.memLevel,
    opt.strategy
  );

  if (status !== Z_OK) {
    throw new Error(msg[status]);
  }

  if (opt.header) {
    zlib_deflate.deflateSetHeader(this.strm, opt.header);
  }

  if (opt.dictionary) {
    let dict;
    // Convert data if needed
    if (typeof opt.dictionary === 'string') {
      // If we need to compress text, change encoding to utf8.
      dict = strings.string2buf(opt.dictionary);
    } else if (toString.call(opt.dictionary) === '[object ArrayBuffer]') {
      dict = new Uint8Array(opt.dictionary);
    } else {
      dict = opt.dictionary;
    }

    status = zlib_deflate.deflateSetDictionary(this.strm, dict);

    if (status !== Z_OK) {
      throw new Error(msg[status]);
    }

    this._dict_set = true;
  }
}

/**
 * Deflate#push(data[, flush_mode]) -> Boolean
 * - data (Uint8Array|ArrayBuffer|String): input data. Strings will be
 *   converted to utf8 byte sequence.
 * - flush_mode (Number|Boolean): 0..6 for corresponding Z_NO_FLUSH..Z_TREE modes.
 *   See constants. Skipped or `false` means Z_NO_FLUSH, `true` means Z_FINISH.
 *
 * Sends input data to deflate pipe, generating [[Deflate#onData]] calls with
 * new compressed chunks. Returns `true` on success. The last data block must
 * have `flush_mode` Z_FINISH (or `true`). That will flush internal pending
 * buffers and call [[Deflate#onEnd]].
 *
 * On fail call [[Deflate#onEnd]] with error code and return false.
 *
 * ##### Example
 *
 * ```javascript
 * push(chunk, false); // push one of data chunks
 * ...
 * push(chunk, true);  // push last chunk
 * ```
 **/
Deflate.prototype.push = function (data, flush_mode) {
  const strm = this.strm;
  const chunkSize = this.options.chunkSize;
  let status, _flush_mode;

  if (this.ended) { return false; }

  if (flush_mode === ~~flush_mode) _flush_mode = flush_mode;
  else _flush_mode = flush_mode === true ? Z_FINISH : Z_NO_FLUSH;

  // Convert data if needed
  if (typeof data === 'string') {
    // If we need to compress text, change encoding to utf8.
    strm.input = strings.string2buf(data);
  } else if (toString.call(data) === '[object ArrayBuffer]') {
    strm.input = new Uint8Array(data);
  } else {
    strm.input = data;
  }

  strm.next_in = 0;
  strm.avail_in = strm.input.length;

  for (;;) {
    if (strm.avail_out === 0) {
      strm.output = new Uint8Array(chunkSize);
      strm.next_out = 0;
      strm.avail_out = chunkSize;
    }

    // Make sure avail_out > 6 to avoid repeating markers
    if ((_flush_mode === Z_SYNC_FLUSH || _flush_mode === Z_FULL_FLUSH) && strm.avail_out <= 6) {
      this.onData(strm.output.subarray(0, strm.next_out));
      strm.avail_out = 0;
      continue;
    }

    status = zlib_deflate.deflate(strm, _flush_mode);

    // Ended => flush and finish
    if (status === Z_STREAM_END) {
      if (strm.next_out > 0) {
        this.onData(strm.output.subarray(0, strm.next_out));
      }
      status = zlib_deflate.deflateEnd(this.strm);
      this.onEnd(status);
      this.ended = true;
      return status === Z_OK;
    }

    // Flush if out buffer full
    if (strm.avail_out === 0) {
      this.onData(strm.output);
      continue;
    }

    // Flush if requested and has data
    if (_flush_mode > 0 && strm.next_out > 0) {
      this.onData(strm.output.subarray(0, strm.next_out));
      strm.avail_out = 0;
      continue;
    }

    if (strm.avail_in === 0) break;
  }

  return true;
};


/**
 * Deflate#onData(chunk) -> Void
 * - chunk (Uint8Array): output data.
 *
 * By default, stores data blocks in `chunks[]` property and glue
 * those in `onEnd`. Override this handler, if you need another behaviour.
 **/
Deflate.prototype.onData = function (chunk) {
  this.chunks.push(chunk);
};


/**
 * Deflate#onEnd(status) -> Void
 * - status (Number): deflate status. 0 (Z_OK) on success,
 *   other if not.
 *
 * Called once after you tell deflate that the input stream is
 * complete (Z_FINISH). By default - join collected chunks,
 * free memory and fill `results` / `err` properties.
 **/
Deflate.prototype.onEnd = function (status) {
  // On success - join
  if (status === Z_OK) {
    this.result = utils.flattenChunks(this.chunks);
  }
  this.chunks = [];
  this.err = status;
  this.msg = this.strm.msg;
};


/**
 * deflate(data[, options]) -> Uint8Array
 * - data (Uint8Array|String): input data to compress.
 * - options (Object): zlib deflate options.
 *
 * Compress `data` with deflate algorithm and `options`.
 *
 * Supported options are:
 *
 * - level
 * - windowBits
 * - memLevel
 * - strategy
 * - dictionary
 *
 * [http://zlib.net/manual.html#Advanced](http://zlib.net/manual.html#Advanced)
 * for more information on these.
 *
 * Sugar (options):
 *
 * - `raw` (Boolean) - say that we work with raw stream, if you don't wish to specify
 *   negative windowBits implicitly.
 *
 * ##### Example:
 *
 * ```javascript
 * const pako = require('pako')
 * const data = new Uint8Array([1,2,3,4,5,6,7,8,9]);
 *
 * console.log(pako.deflate(data));
 * ```
 **/
function deflate(input, options) {
  const deflator = new Deflate(options);

  deflator.push(input, true);

  // That will never happens, if you don't cheat with options :)
  if (deflator.err) { throw deflator.msg || msg[deflator.err]; }

  return deflator.result;
}


/**
 * deflateRaw(data[, options]) -> Uint8Array
 * - data (Uint8Array|String): input data to compress.
 * - options (Object): zlib deflate options.
 *
 * The same as [[deflate]], but creates raw data, without wrapper
 * (header and adler32 crc).
 **/
function deflateRaw(input, options) {
  options = options || {};
  options.raw = true;
  return deflate(input, options);
}


/**
 * gzip(data[, options]) -> Uint8Array
 * - data (Uint8Array|String): input data to compress.
 * - options (Object): zlib deflate options.
 *
 * The same as [[deflate]], but create gzip wrapper instead of
 * deflate one.
 **/
function gzip(input, options) {
  options = options || {};
  options.gzip = true;
  return deflate(input, options);
}


module.exports.Deflate = Deflate;
module.exports.deflate = deflate;
module.exports.deflateRaw = deflateRaw;
module.exports.gzip = gzip;
module.exports.constants = __webpack_require__(/*! ./zlib/constants */ "./node_modules/pako/lib/zlib/constants.js");


/***/ }),

/***/ "./node_modules/pako/lib/inflate.js":
/*!******************************************!*\
  !*** ./node_modules/pako/lib/inflate.js ***!
  \******************************************/
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";



const zlib_inflate = __webpack_require__(/*! ./zlib/inflate */ "./node_modules/pako/lib/zlib/inflate.js");
const utils        = __webpack_require__(/*! ./utils/common */ "./node_modules/pako/lib/utils/common.js");
const strings      = __webpack_require__(/*! ./utils/strings */ "./node_modules/pako/lib/utils/strings.js");
const msg          = __webpack_require__(/*! ./zlib/messages */ "./node_modules/pako/lib/zlib/messages.js");
const ZStream      = __webpack_require__(/*! ./zlib/zstream */ "./node_modules/pako/lib/zlib/zstream.js");
const GZheader     = __webpack_require__(/*! ./zlib/gzheader */ "./node_modules/pako/lib/zlib/gzheader.js");

const toString = Object.prototype.toString;

/* Public constants ==========================================================*/
/* ===========================================================================*/

const {
  Z_NO_FLUSH, Z_FINISH,
  Z_OK, Z_STREAM_END, Z_NEED_DICT, Z_STREAM_ERROR, Z_DATA_ERROR, Z_MEM_ERROR
} = __webpack_require__(/*! ./zlib/constants */ "./node_modules/pako/lib/zlib/constants.js");

/* ===========================================================================*/


/**
 * class Inflate
 *
 * Generic JS-style wrapper for zlib calls. If you don't need
 * streaming behaviour - use more simple functions: [[inflate]]
 * and [[inflateRaw]].
 **/

/* internal
 * inflate.chunks -> Array
 *
 * Chunks of output data, if [[Inflate#onData]] not overridden.
 **/

/**
 * Inflate.result -> Uint8Array|String
 *
 * Uncompressed result, generated by default [[Inflate#onData]]
 * and [[Inflate#onEnd]] handlers. Filled after you push last chunk
 * (call [[Inflate#push]] with `Z_FINISH` / `true` param).
 **/

/**
 * Inflate.err -> Number
 *
 * Error code after inflate finished. 0 (Z_OK) on success.
 * Should be checked if broken data possible.
 **/

/**
 * Inflate.msg -> String
 *
 * Error message, if [[Inflate.err]] != 0
 **/


/**
 * new Inflate(options)
 * - options (Object): zlib inflate options.
 *
 * Creates new inflator instance with specified params. Throws exception
 * on bad params. Supported options:
 *
 * - `windowBits`
 * - `dictionary`
 *
 * [http://zlib.net/manual.html#Advanced](http://zlib.net/manual.html#Advanced)
 * for more information on these.
 *
 * Additional options, for internal needs:
 *
 * - `chunkSize` - size of generated data chunks (16K by default)
 * - `raw` (Boolean) - do raw inflate
 * - `to` (String) - if equal to 'string', then result will be converted
 *   from utf8 to utf16 (javascript) string. When string output requested,
 *   chunk length can differ from `chunkSize`, depending on content.
 *
 * By default, when no options set, autodetect deflate/gzip data format via
 * wrapper header.
 *
 * ##### Example:
 *
 * ```javascript
 * const pako = require('pako')
 * const chunk1 = new Uint8Array([1,2,3,4,5,6,7,8,9])
 * const chunk2 = new Uint8Array([10,11,12,13,14,15,16,17,18,19]);
 *
 * const inflate = new pako.Inflate({ level: 3});
 *
 * inflate.push(chunk1, false);
 * inflate.push(chunk2, true);  // true -> last chunk
 *
 * if (inflate.err) { throw new Error(inflate.err); }
 *
 * console.log(inflate.result);
 * ```
 **/
function Inflate(options) {
  this.options = utils.assign({
    chunkSize: 1024 * 64,
    windowBits: 15,
    to: ''
  }, options || {});

  const opt = this.options;

  // Force window size for `raw` data, if not set directly,
  // because we have no header for autodetect.
  if (opt.raw && (opt.windowBits >= 0) && (opt.windowBits < 16)) {
    opt.windowBits = -opt.windowBits;
    if (opt.windowBits === 0) { opt.windowBits = -15; }
  }

  // If `windowBits` not defined (and mode not raw) - set autodetect flag for gzip/deflate
  if ((opt.windowBits >= 0) && (opt.windowBits < 16) &&
      !(options && options.windowBits)) {
    opt.windowBits += 32;
  }

  // Gzip header has no info about windows size, we can do autodetect only
  // for deflate. So, if window size not set, force it to max when gzip possible
  if ((opt.windowBits > 15) && (opt.windowBits < 48)) {
    // bit 3 (16) -> gzipped data
    // bit 4 (32) -> autodetect gzip/deflate
    if ((opt.windowBits & 15) === 0) {
      opt.windowBits |= 15;
    }
  }

  this.err    = 0;      // error code, if happens (0 = Z_OK)
  this.msg    = '';     // error message
  this.ended  = false;  // used to avoid multiple onEnd() calls
  this.chunks = [];     // chunks of compressed data

  this.strm   = new ZStream();
  this.strm.avail_out = 0;

  let status  = zlib_inflate.inflateInit2(
    this.strm,
    opt.windowBits
  );

  if (status !== Z_OK) {
    throw new Error(msg[status]);
  }

  this.header = new GZheader();

  zlib_inflate.inflateGetHeader(this.strm, this.header);

  // Setup dictionary
  if (opt.dictionary) {
    // Convert data if needed
    if (typeof opt.dictionary === 'string') {
      opt.dictionary = strings.string2buf(opt.dictionary);
    } else if (toString.call(opt.dictionary) === '[object ArrayBuffer]') {
      opt.dictionary = new Uint8Array(opt.dictionary);
    }
    if (opt.raw) { //In raw mode we need to set the dictionary early
      status = zlib_inflate.inflateSetDictionary(this.strm, opt.dictionary);
      if (status !== Z_OK) {
        throw new Error(msg[status]);
      }
    }
  }
}

/**
 * Inflate#push(data[, flush_mode]) -> Boolean
 * - data (Uint8Array|ArrayBuffer): input data
 * - flush_mode (Number|Boolean): 0..6 for corresponding Z_NO_FLUSH..Z_TREE
 *   flush modes. See constants. Skipped or `false` means Z_NO_FLUSH,
 *   `true` means Z_FINISH.
 *
 * Sends input data to inflate pipe, generating [[Inflate#onData]] calls with
 * new output chunks. Returns `true` on success. If end of stream detected,
 * [[Inflate#onEnd]] will be called.
 *
 * `flush_mode` is not needed for normal operation, because end of stream
 * detected automatically. You may try to use it for advanced things, but
 * this functionality was not tested.
 *
 * On fail call [[Inflate#onEnd]] with error code and return false.
 *
 * ##### Example
 *
 * ```javascript
 * push(chunk, false); // push one of data chunks
 * ...
 * push(chunk, true);  // push last chunk
 * ```
 **/
Inflate.prototype.push = function (data, flush_mode) {
  const strm = this.strm;
  const chunkSize = this.options.chunkSize;
  const dictionary = this.options.dictionary;
  let status, _flush_mode, last_avail_out;

  if (this.ended) return false;

  if (flush_mode === ~~flush_mode) _flush_mode = flush_mode;
  else _flush_mode = flush_mode === true ? Z_FINISH : Z_NO_FLUSH;

  // Convert data if needed
  if (toString.call(data) === '[object ArrayBuffer]') {
    strm.input = new Uint8Array(data);
  } else {
    strm.input = data;
  }

  strm.next_in = 0;
  strm.avail_in = strm.input.length;

  for (;;) {
    if (strm.avail_out === 0) {
      strm.output = new Uint8Array(chunkSize);
      strm.next_out = 0;
      strm.avail_out = chunkSize;
    }

    status = zlib_inflate.inflate(strm, _flush_mode);

    if (status === Z_NEED_DICT && dictionary) {
      status = zlib_inflate.inflateSetDictionary(strm, dictionary);

      if (status === Z_OK) {
        status = zlib_inflate.inflate(strm, _flush_mode);
      } else if (status === Z_DATA_ERROR) {
        // Replace code with more verbose
        status = Z_NEED_DICT;
      }
    }

    // Skip snyc markers if more data follows and not raw mode
    while (strm.avail_in > 0 &&
           status === Z_STREAM_END &&
           strm.state.wrap > 0 &&
           data[strm.next_in] !== 0)
    {
      zlib_inflate.inflateReset(strm);
      status = zlib_inflate.inflate(strm, _flush_mode);
    }

    switch (status) {
      case Z_STREAM_ERROR:
      case Z_DATA_ERROR:
      case Z_NEED_DICT:
      case Z_MEM_ERROR:
        this.onEnd(status);
        this.ended = true;
        return false;
    }

    // Remember real `avail_out` value, because we may patch out buffer content
    // to align utf8 strings boundaries.
    last_avail_out = strm.avail_out;

    if (strm.next_out) {
      if (strm.avail_out === 0 || status === Z_STREAM_END) {

        if (this.options.to === 'string') {

          let next_out_utf8 = strings.utf8border(strm.output, strm.next_out);

          let tail = strm.next_out - next_out_utf8;
          let utf8str = strings.buf2string(strm.output, next_out_utf8);

          // move tail & realign counters
          strm.next_out = tail;
          strm.avail_out = chunkSize - tail;
          if (tail) strm.output.set(strm.output.subarray(next_out_utf8, next_out_utf8 + tail), 0);

          this.onData(utf8str);

        } else {
          this.onData(strm.output.length === strm.next_out ? strm.output : strm.output.subarray(0, strm.next_out));
        }
      }
    }

    // Must repeat iteration if out buffer is full
    if (status === Z_OK && last_avail_out === 0) continue;

    // Finalize if end of stream reached.
    if (status === Z_STREAM_END) {
      status = zlib_inflate.inflateEnd(this.strm);
      this.onEnd(status);
      this.ended = true;
      return true;
    }

    if (strm.avail_in === 0) break;
  }

  return true;
};


/**
 * Inflate#onData(chunk) -> Void
 * - chunk (Uint8Array|String): output data. When string output requested,
 *   each chunk will be string.
 *
 * By default, stores data blocks in `chunks[]` property and glue
 * those in `onEnd`. Override this handler, if you need another behaviour.
 **/
Inflate.prototype.onData = function (chunk) {
  this.chunks.push(chunk);
};


/**
 * Inflate#onEnd(status) -> Void
 * - status (Number): inflate status. 0 (Z_OK) on success,
 *   other if not.
 *
 * Called either after you tell inflate that the input stream is
 * complete (Z_FINISH). By default - join collected chunks,
 * free memory and fill `results` / `err` properties.
 **/
Inflate.prototype.onEnd = function (status) {
  // On success - join
  if (status === Z_OK) {
    if (this.options.to === 'string') {
      this.result = this.chunks.join('');
    } else {
      this.result = utils.flattenChunks(this.chunks);
    }
  }
  this.chunks = [];
  this.err = status;
  this.msg = this.strm.msg;
};


/**
 * inflate(data[, options]) -> Uint8Array|String
 * - data (Uint8Array): input data to decompress.
 * - options (Object): zlib inflate options.
 *
 * Decompress `data` with inflate/ungzip and `options`. Autodetect
 * format via wrapper header by default. That's why we don't provide
 * separate `ungzip` method.
 *
 * Supported options are:
 *
 * - windowBits
 *
 * [http://zlib.net/manual.html#Advanced](http://zlib.net/manual.html#Advanced)
 * for more information.
 *
 * Sugar (options):
 *
 * - `raw` (Boolean) - say that we work with raw stream, if you don't wish to specify
 *   negative windowBits implicitly.
 * - `to` (String) - if equal to 'string', then result will be converted
 *   from utf8 to utf16 (javascript) string. When string output requested,
 *   chunk length can differ from `chunkSize`, depending on content.
 *
 *
 * ##### Example:
 *
 * ```javascript
 * const pako = require('pako');
 * const input = pako.deflate(new Uint8Array([1,2,3,4,5,6,7,8,9]));
 * let output;
 *
 * try {
 *   output = pako.inflate(input);
 * } catch (err)
 *   console.log(err);
 * }
 * ```
 **/
function inflate(input, options) {
  const inflator = new Inflate(options);

  inflator.push(input);

  // That will never happens, if you don't cheat with options :)
  if (inflator.err) throw inflator.msg || msg[inflator.err];

  return inflator.result;
}


/**
 * inflateRaw(data[, options]) -> Uint8Array|String
 * - data (Uint8Array): input data to decompress.
 * - options (Object): zlib inflate options.
 *
 * The same as [[inflate]], but creates raw data, without wrapper
 * (header and adler32 crc).
 **/
function inflateRaw(input, options) {
  options = options || {};
  options.raw = true;
  return inflate(input, options);
}


/**
 * ungzip(data[, options]) -> Uint8Array|String
 * - data (Uint8Array): input data to decompress.
 * - options (Object): zlib inflate options.
 *
 * Just shortcut to [[inflate]], because it autodetects format
 * by header.content. Done for convenience.
 **/


module.exports.Inflate = Inflate;
module.exports.inflate = inflate;
module.exports.inflateRaw = inflateRaw;
module.exports.ungzip = inflate;
module.exports.constants = __webpack_require__(/*! ./zlib/constants */ "./node_modules/pako/lib/zlib/constants.js");


/***/ }),

/***/ "./node_modules/pako/lib/utils/common.js":
/*!***********************************************!*\
  !*** ./node_modules/pako/lib/utils/common.js ***!
  \***********************************************/
/***/ (function(module) {

"use strict";



const _has = (obj, key) => {
  return Object.prototype.hasOwnProperty.call(obj, key);
};

module.exports.assign = function (obj /*from1, from2, from3, ...*/) {
  const sources = Array.prototype.slice.call(arguments, 1);
  while (sources.length) {
    const source = sources.shift();
    if (!source) { continue; }

    if (typeof source !== 'object') {
      throw new TypeError(source + 'must be non-object');
    }

    for (const p in source) {
      if (_has(source, p)) {
        obj[p] = source[p];
      }
    }
  }

  return obj;
};


// Join array of chunks to single array.
module.exports.flattenChunks = (chunks) => {
  // calculate data length
  let len = 0;

  for (let i = 0, l = chunks.length; i < l; i++) {
    len += chunks[i].length;
  }

  // join chunks
  const result = new Uint8Array(len);

  for (let i = 0, pos = 0, l = chunks.length; i < l; i++) {
    let chunk = chunks[i];
    result.set(chunk, pos);
    pos += chunk.length;
  }

  return result;
};


/***/ }),

/***/ "./node_modules/pako/lib/utils/strings.js":
/*!************************************************!*\
  !*** ./node_modules/pako/lib/utils/strings.js ***!
  \************************************************/
/***/ (function(module) {

"use strict";
// String encode/decode helpers



// Quick check if we can use fast array to bin string conversion
//
// - apply(Array) can fail on Android 2.2
// - apply(Uint8Array) can fail on iOS 5.1 Safari
//
let STR_APPLY_UIA_OK = true;

try { String.fromCharCode.apply(null, new Uint8Array(1)); } catch (__) { STR_APPLY_UIA_OK = false; }


// Table with utf8 lengths (calculated by first byte of sequence)
// Note, that 5 & 6-byte values and some 4-byte values can not be represented in JS,
// because max possible codepoint is 0x10ffff
const _utf8len = new Uint8Array(256);
for (let q = 0; q < 256; q++) {
  _utf8len[q] = (q >= 252 ? 6 : q >= 248 ? 5 : q >= 240 ? 4 : q >= 224 ? 3 : q >= 192 ? 2 : 1);
}
_utf8len[254] = _utf8len[254] = 1; // Invalid sequence start


// convert string to array (typed, when possible)
module.exports.string2buf = (str) => {
  let buf, c, c2, m_pos, i, str_len = str.length, buf_len = 0;

  // count binary size
  for (m_pos = 0; m_pos < str_len; m_pos++) {
    c = str.charCodeAt(m_pos);
    if ((c & 0xfc00) === 0xd800 && (m_pos + 1 < str_len)) {
      c2 = str.charCodeAt(m_pos + 1);
      if ((c2 & 0xfc00) === 0xdc00) {
        c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        m_pos++;
      }
    }
    buf_len += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }

  // allocate buffer
  buf = new Uint8Array(buf_len);

  // convert
  for (i = 0, m_pos = 0; i < buf_len; m_pos++) {
    c = str.charCodeAt(m_pos);
    if ((c & 0xfc00) === 0xd800 && (m_pos + 1 < str_len)) {
      c2 = str.charCodeAt(m_pos + 1);
      if ((c2 & 0xfc00) === 0xdc00) {
        c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        m_pos++;
      }
    }
    if (c < 0x80) {
      /* one byte */
      buf[i++] = c;
    } else if (c < 0x800) {
      /* two bytes */
      buf[i++] = 0xC0 | (c >>> 6);
      buf[i++] = 0x80 | (c & 0x3f);
    } else if (c < 0x10000) {
      /* three bytes */
      buf[i++] = 0xE0 | (c >>> 12);
      buf[i++] = 0x80 | (c >>> 6 & 0x3f);
      buf[i++] = 0x80 | (c & 0x3f);
    } else {
      /* four bytes */
      buf[i++] = 0xf0 | (c >>> 18);
      buf[i++] = 0x80 | (c >>> 12 & 0x3f);
      buf[i++] = 0x80 | (c >>> 6 & 0x3f);
      buf[i++] = 0x80 | (c & 0x3f);
    }
  }

  return buf;
};

// Helper
const buf2binstring = (buf, len) => {
  // On Chrome, the arguments in a function call that are allowed is `65534`.
  // If the length of the buffer is smaller than that, we can use this optimization,
  // otherwise we will take a slower path.
  if (len < 65534) {
    if (buf.subarray && STR_APPLY_UIA_OK) {
      return String.fromCharCode.apply(null, buf.length === len ? buf : buf.subarray(0, len));
    }
  }

  let result = '';
  for (let i = 0; i < len; i++) {
    result += String.fromCharCode(buf[i]);
  }
  return result;
};


// convert array to string
module.exports.buf2string = (buf, max) => {
  let i, out;
  const len = max || buf.length;

  // Reserve max possible length (2 words per char)
  // NB: by unknown reasons, Array is significantly faster for
  //     String.fromCharCode.apply than Uint16Array.
  const utf16buf = new Array(len * 2);

  for (out = 0, i = 0; i < len;) {
    let c = buf[i++];
    // quick process ascii
    if (c < 0x80) { utf16buf[out++] = c; continue; }

    let c_len = _utf8len[c];
    // skip 5 & 6 byte codes
    if (c_len > 4) { utf16buf[out++] = 0xfffd; i += c_len - 1; continue; }

    // apply mask on first byte
    c &= c_len === 2 ? 0x1f : c_len === 3 ? 0x0f : 0x07;
    // join the rest
    while (c_len > 1 && i < len) {
      c = (c << 6) | (buf[i++] & 0x3f);
      c_len--;
    }

    // terminated by end of string?
    if (c_len > 1) { utf16buf[out++] = 0xfffd; continue; }

    if (c < 0x10000) {
      utf16buf[out++] = c;
    } else {
      c -= 0x10000;
      utf16buf[out++] = 0xd800 | ((c >> 10) & 0x3ff);
      utf16buf[out++] = 0xdc00 | (c & 0x3ff);
    }
  }

  return buf2binstring(utf16buf, out);
};


// Calculate max possible position in utf8 buffer,
// that will not break sequence. If that's not possible
// - (very small limits) return max size as is.
//
// buf[] - utf8 bytes array
// max   - length limit (mandatory);
module.exports.utf8border = (buf, max) => {

  max = max || buf.length;
  if (max > buf.length) { max = buf.length; }

  // go back from last position, until start of sequence found
  let pos = max - 1;
  while (pos >= 0 && (buf[pos] & 0xC0) === 0x80) { pos--; }

  // Very small and broken sequence,
  // return max, because we should return something anyway.
  if (pos < 0) { return max; }

  // If we came to start of buffer - that means buffer is too small,
  // return max too.
  if (pos === 0) { return max; }

  return (pos + _utf8len[buf[pos]] > max) ? pos : max;
};


/***/ }),

/***/ "./node_modules/pako/lib/zlib/adler32.js":
/*!***********************************************!*\
  !*** ./node_modules/pako/lib/zlib/adler32.js ***!
  \***********************************************/
/***/ (function(module) {

"use strict";


// Note: adler32 takes 12% for level 0 and 2% for level 6.
// It isn't worth it to make additional optimizations as in original.
// Small size is preferable.

// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

const adler32 = (adler, buf, len, pos) => {
  let s1 = (adler & 0xffff) |0,
      s2 = ((adler >>> 16) & 0xffff) |0,
      n = 0;

  while (len !== 0) {
    // Set limit ~ twice less than 5552, to keep
    // s2 in 31-bits, because we force signed ints.
    // in other case %= will fail.
    n = len > 2000 ? 2000 : len;
    len -= n;

    do {
      s1 = (s1 + buf[pos++]) |0;
      s2 = (s2 + s1) |0;
    } while (--n);

    s1 %= 65521;
    s2 %= 65521;
  }

  return (s1 | (s2 << 16)) |0;
};


module.exports = adler32;


/***/ }),

/***/ "./node_modules/pako/lib/zlib/constants.js":
/*!*************************************************!*\
  !*** ./node_modules/pako/lib/zlib/constants.js ***!
  \*************************************************/
/***/ (function(module) {

"use strict";


// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

module.exports = {

  /* Allowed flush values; see deflate() and inflate() below for details */
  Z_NO_FLUSH:         0,
  Z_PARTIAL_FLUSH:    1,
  Z_SYNC_FLUSH:       2,
  Z_FULL_FLUSH:       3,
  Z_FINISH:           4,
  Z_BLOCK:            5,
  Z_TREES:            6,

  /* Return codes for the compression/decompression functions. Negative values
  * are errors, positive values are used for special but normal events.
  */
  Z_OK:               0,
  Z_STREAM_END:       1,
  Z_NEED_DICT:        2,
  Z_ERRNO:           -1,
  Z_STREAM_ERROR:    -2,
  Z_DATA_ERROR:      -3,
  Z_MEM_ERROR:       -4,
  Z_BUF_ERROR:       -5,
  //Z_VERSION_ERROR: -6,

  /* compression levels */
  Z_NO_COMPRESSION:         0,
  Z_BEST_SPEED:             1,
  Z_BEST_COMPRESSION:       9,
  Z_DEFAULT_COMPRESSION:   -1,


  Z_FILTERED:               1,
  Z_HUFFMAN_ONLY:           2,
  Z_RLE:                    3,
  Z_FIXED:                  4,
  Z_DEFAULT_STRATEGY:       0,

  /* Possible values of the data_type field (though see inflate()) */
  Z_BINARY:                 0,
  Z_TEXT:                   1,
  //Z_ASCII:                1, // = Z_TEXT (deprecated)
  Z_UNKNOWN:                2,

  /* The deflate compression method */
  Z_DEFLATED:               8
  //Z_NULL:                 null // Use -1 or null inline, depending on var type
};


/***/ }),

/***/ "./node_modules/pako/lib/zlib/crc32.js":
/*!*********************************************!*\
  !*** ./node_modules/pako/lib/zlib/crc32.js ***!
  \*********************************************/
/***/ (function(module) {

"use strict";


// Note: we can't get significant speed boost here.
// So write code to minimize size - no pregenerated tables
// and array tools dependencies.

// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

// Use ordinary array, since untyped makes no boost here
const makeTable = () => {
  let c, table = [];

  for (var n = 0; n < 256; n++) {
    c = n;
    for (var k = 0; k < 8; k++) {
      c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
    }
    table[n] = c;
  }

  return table;
};

// Create table on load. Just 255 signed longs. Not a problem.
const crcTable = new Uint32Array(makeTable());


const crc32 = (crc, buf, len, pos) => {
  const t = crcTable;
  const end = pos + len;

  crc ^= -1;

  for (let i = pos; i < end; i++) {
    crc = (crc >>> 8) ^ t[(crc ^ buf[i]) & 0xFF];
  }

  return (crc ^ (-1)); // >>> 0;
};


module.exports = crc32;


/***/ }),

/***/ "./node_modules/pako/lib/zlib/deflate.js":
/*!***********************************************!*\
  !*** ./node_modules/pako/lib/zlib/deflate.js ***!
  \***********************************************/
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";


// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

const { _tr_init, _tr_stored_block, _tr_flush_block, _tr_tally, _tr_align } = __webpack_require__(/*! ./trees */ "./node_modules/pako/lib/zlib/trees.js");
const adler32 = __webpack_require__(/*! ./adler32 */ "./node_modules/pako/lib/zlib/adler32.js");
const crc32   = __webpack_require__(/*! ./crc32 */ "./node_modules/pako/lib/zlib/crc32.js");
const msg     = __webpack_require__(/*! ./messages */ "./node_modules/pako/lib/zlib/messages.js");

/* Public constants ==========================================================*/
/* ===========================================================================*/

const {
  Z_NO_FLUSH, Z_PARTIAL_FLUSH, Z_FULL_FLUSH, Z_FINISH, Z_BLOCK,
  Z_OK, Z_STREAM_END, Z_STREAM_ERROR, Z_DATA_ERROR, Z_BUF_ERROR,
  Z_DEFAULT_COMPRESSION,
  Z_FILTERED, Z_HUFFMAN_ONLY, Z_RLE, Z_FIXED, Z_DEFAULT_STRATEGY,
  Z_UNKNOWN,
  Z_DEFLATED
} = __webpack_require__(/*! ./constants */ "./node_modules/pako/lib/zlib/constants.js");

/*============================================================================*/


const MAX_MEM_LEVEL = 9;
/* Maximum value for memLevel in deflateInit2 */
const MAX_WBITS = 15;
/* 32K LZ77 window */
const DEF_MEM_LEVEL = 8;


const LENGTH_CODES  = 29;
/* number of length codes, not counting the special END_BLOCK code */
const LITERALS      = 256;
/* number of literal bytes 0..255 */
const L_CODES       = LITERALS + 1 + LENGTH_CODES;
/* number of Literal or Length codes, including the END_BLOCK code */
const D_CODES       = 30;
/* number of distance codes */
const BL_CODES      = 19;
/* number of codes used to transfer the bit lengths */
const HEAP_SIZE     = 2 * L_CODES + 1;
/* maximum heap size */
const MAX_BITS  = 15;
/* All codes must not exceed MAX_BITS bits */

const MIN_MATCH = 3;
const MAX_MATCH = 258;
const MIN_LOOKAHEAD = (MAX_MATCH + MIN_MATCH + 1);

const PRESET_DICT = 0x20;

const INIT_STATE = 42;
const EXTRA_STATE = 69;
const NAME_STATE = 73;
const COMMENT_STATE = 91;
const HCRC_STATE = 103;
const BUSY_STATE = 113;
const FINISH_STATE = 666;

const BS_NEED_MORE      = 1; /* block not completed, need more input or more output */
const BS_BLOCK_DONE     = 2; /* block flush performed */
const BS_FINISH_STARTED = 3; /* finish started, need only more output at next deflate */
const BS_FINISH_DONE    = 4; /* finish done, accept no more input or output */

const OS_CODE = 0x03; // Unix :) . Don't detect, use this default.

const err = (strm, errorCode) => {
  strm.msg = msg[errorCode];
  return errorCode;
};

const rank = (f) => {
  return ((f) << 1) - ((f) > 4 ? 9 : 0);
};

const zero = (buf) => {
  let len = buf.length; while (--len >= 0) { buf[len] = 0; }
};


/* eslint-disable new-cap */
let HASH_ZLIB = (s, prev, data) => ((prev << s.hash_shift) ^ data) & s.hash_mask;
// This hash causes less collisions, https://github.com/nodeca/pako/issues/135
// But breaks binary compatibility
//let HASH_FAST = (s, prev, data) => ((prev << 8) + (prev >> 8) + (data << 4)) & s.hash_mask;
let HASH = HASH_ZLIB;

/* =========================================================================
 * Flush as much pending output as possible. All deflate() output goes
 * through this function so some applications may wish to modify it
 * to avoid allocating a large strm->output buffer and copying into it.
 * (See also read_buf()).
 */
const flush_pending = (strm) => {
  const s = strm.state;

  //_tr_flush_bits(s);
  let len = s.pending;
  if (len > strm.avail_out) {
    len = strm.avail_out;
  }
  if (len === 0) { return; }

  strm.output.set(s.pending_buf.subarray(s.pending_out, s.pending_out + len), strm.next_out);
  strm.next_out += len;
  s.pending_out += len;
  strm.total_out += len;
  strm.avail_out -= len;
  s.pending -= len;
  if (s.pending === 0) {
    s.pending_out = 0;
  }
};


const flush_block_only = (s, last) => {
  _tr_flush_block(s, (s.block_start >= 0 ? s.block_start : -1), s.strstart - s.block_start, last);
  s.block_start = s.strstart;
  flush_pending(s.strm);
};


const put_byte = (s, b) => {
  s.pending_buf[s.pending++] = b;
};


/* =========================================================================
 * Put a short in the pending buffer. The 16-bit value is put in MSB order.
 * IN assertion: the stream state is correct and there is enough room in
 * pending_buf.
 */
const putShortMSB = (s, b) => {

  //  put_byte(s, (Byte)(b >> 8));
//  put_byte(s, (Byte)(b & 0xff));
  s.pending_buf[s.pending++] = (b >>> 8) & 0xff;
  s.pending_buf[s.pending++] = b & 0xff;
};


/* ===========================================================================
 * Read a new buffer from the current input stream, update the adler32
 * and total number of bytes read.  All deflate() input goes through
 * this function so some applications may wish to modify it to avoid
 * allocating a large strm->input buffer and copying from it.
 * (See also flush_pending()).
 */
const read_buf = (strm, buf, start, size) => {

  let len = strm.avail_in;

  if (len > size) { len = size; }
  if (len === 0) { return 0; }

  strm.avail_in -= len;

  // zmemcpy(buf, strm->next_in, len);
  buf.set(strm.input.subarray(strm.next_in, strm.next_in + len), start);
  if (strm.state.wrap === 1) {
    strm.adler = adler32(strm.adler, buf, len, start);
  }

  else if (strm.state.wrap === 2) {
    strm.adler = crc32(strm.adler, buf, len, start);
  }

  strm.next_in += len;
  strm.total_in += len;

  return len;
};


/* ===========================================================================
 * Set match_start to the longest match starting at the given string and
 * return its length. Matches shorter or equal to prev_length are discarded,
 * in which case the result is equal to prev_length and match_start is
 * garbage.
 * IN assertions: cur_match is the head of the hash chain for the current
 *   string (strstart) and its distance is <= MAX_DIST, and prev_length >= 1
 * OUT assertion: the match length is not greater than s->lookahead.
 */
const longest_match = (s, cur_match) => {

  let chain_length = s.max_chain_length;      /* max hash chain length */
  let scan = s.strstart; /* current string */
  let match;                       /* matched string */
  let len;                           /* length of current match */
  let best_len = s.prev_length;              /* best match length so far */
  let nice_match = s.nice_match;             /* stop if match long enough */
  const limit = (s.strstart > (s.w_size - MIN_LOOKAHEAD)) ?
      s.strstart - (s.w_size - MIN_LOOKAHEAD) : 0/*NIL*/;

  const _win = s.window; // shortcut

  const wmask = s.w_mask;
  const prev  = s.prev;

  /* Stop when cur_match becomes <= limit. To simplify the code,
   * we prevent matches with the string of window index 0.
   */

  const strend = s.strstart + MAX_MATCH;
  let scan_end1  = _win[scan + best_len - 1];
  let scan_end   = _win[scan + best_len];

  /* The code is optimized for HASH_BITS >= 8 and MAX_MATCH-2 multiple of 16.
   * It is easy to get rid of this optimization if necessary.
   */
  // Assert(s->hash_bits >= 8 && MAX_MATCH == 258, "Code too clever");

  /* Do not waste too much time if we already have a good match: */
  if (s.prev_length >= s.good_match) {
    chain_length >>= 2;
  }
  /* Do not look for matches beyond the end of the input. This is necessary
   * to make deflate deterministic.
   */
  if (nice_match > s.lookahead) { nice_match = s.lookahead; }

  // Assert((ulg)s->strstart <= s->window_size-MIN_LOOKAHEAD, "need lookahead");

  do {
    // Assert(cur_match < s->strstart, "no future");
    match = cur_match;

    /* Skip to next match if the match length cannot increase
     * or if the match length is less than 2.  Note that the checks below
     * for insufficient lookahead only occur occasionally for performance
     * reasons.  Therefore uninitialized memory will be accessed, and
     * conditional jumps will be made that depend on those values.
     * However the length of the match is limited to the lookahead, so
     * the output of deflate is not affected by the uninitialized values.
     */

    if (_win[match + best_len]     !== scan_end  ||
        _win[match + best_len - 1] !== scan_end1 ||
        _win[match]                !== _win[scan] ||
        _win[++match]              !== _win[scan + 1]) {
      continue;
    }

    /* The check at best_len-1 can be removed because it will be made
     * again later. (This heuristic is not always a win.)
     * It is not necessary to compare scan[2] and match[2] since they
     * are always equal when the other bytes match, given that
     * the hash keys are equal and that HASH_BITS >= 8.
     */
    scan += 2;
    match++;
    // Assert(*scan == *match, "match[2]?");

    /* We check for insufficient lookahead only every 8th comparison;
     * the 256th check will be made at strstart+258.
     */
    do {
      /*jshint noempty:false*/
    } while (_win[++scan] === _win[++match] && _win[++scan] === _win[++match] &&
             _win[++scan] === _win[++match] && _win[++scan] === _win[++match] &&
             _win[++scan] === _win[++match] && _win[++scan] === _win[++match] &&
             _win[++scan] === _win[++match] && _win[++scan] === _win[++match] &&
             scan < strend);

    // Assert(scan <= s->window+(unsigned)(s->window_size-1), "wild scan");

    len = MAX_MATCH - (strend - scan);
    scan = strend - MAX_MATCH;

    if (len > best_len) {
      s.match_start = cur_match;
      best_len = len;
      if (len >= nice_match) {
        break;
      }
      scan_end1  = _win[scan + best_len - 1];
      scan_end   = _win[scan + best_len];
    }
  } while ((cur_match = prev[cur_match & wmask]) > limit && --chain_length !== 0);

  if (best_len <= s.lookahead) {
    return best_len;
  }
  return s.lookahead;
};


/* ===========================================================================
 * Fill the window when the lookahead becomes insufficient.
 * Updates strstart and lookahead.
 *
 * IN assertion: lookahead < MIN_LOOKAHEAD
 * OUT assertions: strstart <= window_size-MIN_LOOKAHEAD
 *    At least one byte has been read, or avail_in == 0; reads are
 *    performed for at least two bytes (required for the zip translate_eol
 *    option -- not supported here).
 */
const fill_window = (s) => {

  const _w_size = s.w_size;
  let p, n, m, more, str;

  //Assert(s->lookahead < MIN_LOOKAHEAD, "already enough lookahead");

  do {
    more = s.window_size - s.lookahead - s.strstart;

    // JS ints have 32 bit, block below not needed
    /* Deal with !@#$% 64K limit: */
    //if (sizeof(int) <= 2) {
    //    if (more == 0 && s->strstart == 0 && s->lookahead == 0) {
    //        more = wsize;
    //
    //  } else if (more == (unsigned)(-1)) {
    //        /* Very unlikely, but possible on 16 bit machine if
    //         * strstart == 0 && lookahead == 1 (input done a byte at time)
    //         */
    //        more--;
    //    }
    //}


    /* If the window is almost full and there is insufficient lookahead,
     * move the upper half to the lower one to make room in the upper half.
     */
    if (s.strstart >= _w_size + (_w_size - MIN_LOOKAHEAD)) {

      s.window.set(s.window.subarray(_w_size, _w_size + _w_size), 0);
      s.match_start -= _w_size;
      s.strstart -= _w_size;
      /* we now have strstart >= MAX_DIST */
      s.block_start -= _w_size;

      /* Slide the hash table (could be avoided with 32 bit values
       at the expense of memory usage). We slide even when level == 0
       to keep the hash table consistent if we switch back to level > 0
       later. (Using level 0 permanently is not an optimal usage of
       zlib, so we don't care about this pathological case.)
       */

      n = s.hash_size;
      p = n;

      do {
        m = s.head[--p];
        s.head[p] = (m >= _w_size ? m - _w_size : 0);
      } while (--n);

      n = _w_size;
      p = n;

      do {
        m = s.prev[--p];
        s.prev[p] = (m >= _w_size ? m - _w_size : 0);
        /* If n is not on any hash chain, prev[n] is garbage but
         * its value will never be used.
         */
      } while (--n);

      more += _w_size;
    }
    if (s.strm.avail_in === 0) {
      break;
    }

    /* If there was no sliding:
     *    strstart <= WSIZE+MAX_DIST-1 && lookahead <= MIN_LOOKAHEAD - 1 &&
     *    more == window_size - lookahead - strstart
     * => more >= window_size - (MIN_LOOKAHEAD-1 + WSIZE + MAX_DIST-1)
     * => more >= window_size - 2*WSIZE + 2
     * In the BIG_MEM or MMAP case (not yet supported),
     *   window_size == input_size + MIN_LOOKAHEAD  &&
     *   strstart + s->lookahead <= input_size => more >= MIN_LOOKAHEAD.
     * Otherwise, window_size == 2*WSIZE so more >= 2.
     * If there was sliding, more >= WSIZE. So in all cases, more >= 2.
     */
    //Assert(more >= 2, "more < 2");
    n = read_buf(s.strm, s.window, s.strstart + s.lookahead, more);
    s.lookahead += n;

    /* Initialize the hash value now that we have some input: */
    if (s.lookahead + s.insert >= MIN_MATCH) {
      str = s.strstart - s.insert;
      s.ins_h = s.window[str];

      /* UPDATE_HASH(s, s->ins_h, s->window[str + 1]); */
      s.ins_h = HASH(s, s.ins_h, s.window[str + 1]);
//#if MIN_MATCH != 3
//        Call update_hash() MIN_MATCH-3 more times
//#endif
      while (s.insert) {
        /* UPDATE_HASH(s, s->ins_h, s->window[str + MIN_MATCH-1]); */
        s.ins_h = HASH(s, s.ins_h, s.window[str + MIN_MATCH - 1]);

        s.prev[str & s.w_mask] = s.head[s.ins_h];
        s.head[s.ins_h] = str;
        str++;
        s.insert--;
        if (s.lookahead + s.insert < MIN_MATCH) {
          break;
        }
      }
    }
    /* If the whole input has less than MIN_MATCH bytes, ins_h is garbage,
     * but this is not important since only literal bytes will be emitted.
     */

  } while (s.lookahead < MIN_LOOKAHEAD && s.strm.avail_in !== 0);

  /* If the WIN_INIT bytes after the end of the current data have never been
   * written, then zero those bytes in order to avoid memory check reports of
   * the use of uninitialized (or uninitialised as Julian writes) bytes by
   * the longest match routines.  Update the high water mark for the next
   * time through here.  WIN_INIT is set to MAX_MATCH since the longest match
   * routines allow scanning to strstart + MAX_MATCH, ignoring lookahead.
   */
//  if (s.high_water < s.window_size) {
//    const curr = s.strstart + s.lookahead;
//    let init = 0;
//
//    if (s.high_water < curr) {
//      /* Previous high water mark below current data -- zero WIN_INIT
//       * bytes or up to end of window, whichever is less.
//       */
//      init = s.window_size - curr;
//      if (init > WIN_INIT)
//        init = WIN_INIT;
//      zmemzero(s->window + curr, (unsigned)init);
//      s->high_water = curr + init;
//    }
//    else if (s->high_water < (ulg)curr + WIN_INIT) {
//      /* High water mark at or above current data, but below current data
//       * plus WIN_INIT -- zero out to current data plus WIN_INIT, or up
//       * to end of window, whichever is less.
//       */
//      init = (ulg)curr + WIN_INIT - s->high_water;
//      if (init > s->window_size - s->high_water)
//        init = s->window_size - s->high_water;
//      zmemzero(s->window + s->high_water, (unsigned)init);
//      s->high_water += init;
//    }
//  }
//
//  Assert((ulg)s->strstart <= s->window_size - MIN_LOOKAHEAD,
//    "not enough room for search");
};

/* ===========================================================================
 * Copy without compression as much as possible from the input stream, return
 * the current block state.
 * This function does not insert new strings in the dictionary since
 * uncompressible data is probably not useful. This function is used
 * only for the level=0 compression option.
 * NOTE: this function should be optimized to avoid extra copying from
 * window to pending_buf.
 */
const deflate_stored = (s, flush) => {

  /* Stored blocks are limited to 0xffff bytes, pending_buf is limited
   * to pending_buf_size, and each stored block has a 5 byte header:
   */
  let max_block_size = 0xffff;

  if (max_block_size > s.pending_buf_size - 5) {
    max_block_size = s.pending_buf_size - 5;
  }

  /* Copy as much as possible from input to output: */
  for (;;) {
    /* Fill the window as much as possible: */
    if (s.lookahead <= 1) {

      //Assert(s->strstart < s->w_size+MAX_DIST(s) ||
      //  s->block_start >= (long)s->w_size, "slide too late");
//      if (!(s.strstart < s.w_size + (s.w_size - MIN_LOOKAHEAD) ||
//        s.block_start >= s.w_size)) {
//        throw  new Error("slide too late");
//      }

      fill_window(s);
      if (s.lookahead === 0 && flush === Z_NO_FLUSH) {
        return BS_NEED_MORE;
      }

      if (s.lookahead === 0) {
        break;
      }
      /* flush the current block */
    }
    //Assert(s->block_start >= 0L, "block gone");
//    if (s.block_start < 0) throw new Error("block gone");

    s.strstart += s.lookahead;
    s.lookahead = 0;

    /* Emit a stored block if pending_buf will be full: */
    const max_start = s.block_start + max_block_size;

    if (s.strstart === 0 || s.strstart >= max_start) {
      /* strstart == 0 is possible when wraparound on 16-bit machine */
      s.lookahead = s.strstart - max_start;
      s.strstart = max_start;
      /*** FLUSH_BLOCK(s, 0); ***/
      flush_block_only(s, false);
      if (s.strm.avail_out === 0) {
        return BS_NEED_MORE;
      }
      /***/


    }
    /* Flush if we may have to slide, otherwise block_start may become
     * negative and the data will be gone:
     */
    if (s.strstart - s.block_start >= (s.w_size - MIN_LOOKAHEAD)) {
      /*** FLUSH_BLOCK(s, 0); ***/
      flush_block_only(s, false);
      if (s.strm.avail_out === 0) {
        return BS_NEED_MORE;
      }
      /***/
    }
  }

  s.insert = 0;

  if (flush === Z_FINISH) {
    /*** FLUSH_BLOCK(s, 1); ***/
    flush_block_only(s, true);
    if (s.strm.avail_out === 0) {
      return BS_FINISH_STARTED;
    }
    /***/
    return BS_FINISH_DONE;
  }

  if (s.strstart > s.block_start) {
    /*** FLUSH_BLOCK(s, 0); ***/
    flush_block_only(s, false);
    if (s.strm.avail_out === 0) {
      return BS_NEED_MORE;
    }
    /***/
  }

  return BS_NEED_MORE;
};

/* ===========================================================================
 * Compress as much as possible from the input stream, return the current
 * block state.
 * This function does not perform lazy evaluation of matches and inserts
 * new strings in the dictionary only for unmatched strings or for short
 * matches. It is used only for the fast compression options.
 */
const deflate_fast = (s, flush) => {

  let hash_head;        /* head of the hash chain */
  let bflush;           /* set if current block must be flushed */

  for (;;) {
    /* Make sure that we always have enough lookahead, except
     * at the end of the input file. We need MAX_MATCH bytes
     * for the next match, plus MIN_MATCH bytes to insert the
     * string following the next match.
     */
    if (s.lookahead < MIN_LOOKAHEAD) {
      fill_window(s);
      if (s.lookahead < MIN_LOOKAHEAD && flush === Z_NO_FLUSH) {
        return BS_NEED_MORE;
      }
      if (s.lookahead === 0) {
        break; /* flush the current block */
      }
    }

    /* Insert the string window[strstart .. strstart+2] in the
     * dictionary, and set hash_head to the head of the hash chain:
     */
    hash_head = 0/*NIL*/;
    if (s.lookahead >= MIN_MATCH) {
      /*** INSERT_STRING(s, s.strstart, hash_head); ***/
      s.ins_h = HASH(s, s.ins_h, s.window[s.strstart + MIN_MATCH - 1]);
      hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
      s.head[s.ins_h] = s.strstart;
      /***/
    }

    /* Find the longest match, discarding those <= prev_length.
     * At this point we have always match_length < MIN_MATCH
     */
    if (hash_head !== 0/*NIL*/ && ((s.strstart - hash_head) <= (s.w_size - MIN_LOOKAHEAD))) {
      /* To simplify the code, we prevent matches with the string
       * of window index 0 (in particular we have to avoid a match
       * of the string with itself at the start of the input file).
       */
      s.match_length = longest_match(s, hash_head);
      /* longest_match() sets match_start */
    }
    if (s.match_length >= MIN_MATCH) {
      // check_match(s, s.strstart, s.match_start, s.match_length); // for debug only

      /*** _tr_tally_dist(s, s.strstart - s.match_start,
                     s.match_length - MIN_MATCH, bflush); ***/
      bflush = _tr_tally(s, s.strstart - s.match_start, s.match_length - MIN_MATCH);

      s.lookahead -= s.match_length;

      /* Insert new strings in the hash table only if the match length
       * is not too large. This saves time but degrades compression.
       */
      if (s.match_length <= s.max_lazy_match/*max_insert_length*/ && s.lookahead >= MIN_MATCH) {
        s.match_length--; /* string at strstart already in table */
        do {
          s.strstart++;
          /*** INSERT_STRING(s, s.strstart, hash_head); ***/
          s.ins_h = HASH(s, s.ins_h, s.window[s.strstart + MIN_MATCH - 1]);
          hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
          s.head[s.ins_h] = s.strstart;
          /***/
          /* strstart never exceeds WSIZE-MAX_MATCH, so there are
           * always MIN_MATCH bytes ahead.
           */
        } while (--s.match_length !== 0);
        s.strstart++;
      } else
      {
        s.strstart += s.match_length;
        s.match_length = 0;
        s.ins_h = s.window[s.strstart];
        /* UPDATE_HASH(s, s.ins_h, s.window[s.strstart+1]); */
        s.ins_h = HASH(s, s.ins_h, s.window[s.strstart + 1]);

//#if MIN_MATCH != 3
//                Call UPDATE_HASH() MIN_MATCH-3 more times
//#endif
        /* If lookahead < MIN_MATCH, ins_h is garbage, but it does not
         * matter since it will be recomputed at next deflate call.
         */
      }
    } else {
      /* No match, output a literal byte */
      //Tracevv((stderr,"%c", s.window[s.strstart]));
      /*** _tr_tally_lit(s, s.window[s.strstart], bflush); ***/
      bflush = _tr_tally(s, 0, s.window[s.strstart]);

      s.lookahead--;
      s.strstart++;
    }
    if (bflush) {
      /*** FLUSH_BLOCK(s, 0); ***/
      flush_block_only(s, false);
      if (s.strm.avail_out === 0) {
        return BS_NEED_MORE;
      }
      /***/
    }
  }
  s.insert = ((s.strstart < (MIN_MATCH - 1)) ? s.strstart : MIN_MATCH - 1);
  if (flush === Z_FINISH) {
    /*** FLUSH_BLOCK(s, 1); ***/
    flush_block_only(s, true);
    if (s.strm.avail_out === 0) {
      return BS_FINISH_STARTED;
    }
    /***/
    return BS_FINISH_DONE;
  }
  if (s.last_lit) {
    /*** FLUSH_BLOCK(s, 0); ***/
    flush_block_only(s, false);
    if (s.strm.avail_out === 0) {
      return BS_NEED_MORE;
    }
    /***/
  }
  return BS_BLOCK_DONE;
};

/* ===========================================================================
 * Same as above, but achieves better compression. We use a lazy
 * evaluation for matches: a match is finally adopted only if there is
 * no better match at the next window position.
 */
const deflate_slow = (s, flush) => {

  let hash_head;          /* head of hash chain */
  let bflush;              /* set if current block must be flushed */

  let max_insert;

  /* Process the input block. */
  for (;;) {
    /* Make sure that we always have enough lookahead, except
     * at the end of the input file. We need MAX_MATCH bytes
     * for the next match, plus MIN_MATCH bytes to insert the
     * string following the next match.
     */
    if (s.lookahead < MIN_LOOKAHEAD) {
      fill_window(s);
      if (s.lookahead < MIN_LOOKAHEAD && flush === Z_NO_FLUSH) {
        return BS_NEED_MORE;
      }
      if (s.lookahead === 0) { break; } /* flush the current block */
    }

    /* Insert the string window[strstart .. strstart+2] in the
     * dictionary, and set hash_head to the head of the hash chain:
     */
    hash_head = 0/*NIL*/;
    if (s.lookahead >= MIN_MATCH) {
      /*** INSERT_STRING(s, s.strstart, hash_head); ***/
      s.ins_h = HASH(s, s.ins_h, s.window[s.strstart + MIN_MATCH - 1]);
      hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
      s.head[s.ins_h] = s.strstart;
      /***/
    }

    /* Find the longest match, discarding those <= prev_length.
     */
    s.prev_length = s.match_length;
    s.prev_match = s.match_start;
    s.match_length = MIN_MATCH - 1;

    if (hash_head !== 0/*NIL*/ && s.prev_length < s.max_lazy_match &&
        s.strstart - hash_head <= (s.w_size - MIN_LOOKAHEAD)/*MAX_DIST(s)*/) {
      /* To simplify the code, we prevent matches with the string
       * of window index 0 (in particular we have to avoid a match
       * of the string with itself at the start of the input file).
       */
      s.match_length = longest_match(s, hash_head);
      /* longest_match() sets match_start */

      if (s.match_length <= 5 &&
         (s.strategy === Z_FILTERED || (s.match_length === MIN_MATCH && s.strstart - s.match_start > 4096/*TOO_FAR*/))) {

        /* If prev_match is also MIN_MATCH, match_start is garbage
         * but we will ignore the current match anyway.
         */
        s.match_length = MIN_MATCH - 1;
      }
    }
    /* If there was a match at the previous step and the current
     * match is not better, output the previous match:
     */
    if (s.prev_length >= MIN_MATCH && s.match_length <= s.prev_length) {
      max_insert = s.strstart + s.lookahead - MIN_MATCH;
      /* Do not insert strings in hash table beyond this. */

      //check_match(s, s.strstart-1, s.prev_match, s.prev_length);

      /***_tr_tally_dist(s, s.strstart - 1 - s.prev_match,
                     s.prev_length - MIN_MATCH, bflush);***/
      bflush = _tr_tally(s, s.strstart - 1 - s.prev_match, s.prev_length - MIN_MATCH);
      /* Insert in hash table all strings up to the end of the match.
       * strstart-1 and strstart are already inserted. If there is not
       * enough lookahead, the last two strings are not inserted in
       * the hash table.
       */
      s.lookahead -= s.prev_length - 1;
      s.prev_length -= 2;
      do {
        if (++s.strstart <= max_insert) {
          /*** INSERT_STRING(s, s.strstart, hash_head); ***/
          s.ins_h = HASH(s, s.ins_h, s.window[s.strstart + MIN_MATCH - 1]);
          hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
          s.head[s.ins_h] = s.strstart;
          /***/
        }
      } while (--s.prev_length !== 0);
      s.match_available = 0;
      s.match_length = MIN_MATCH - 1;
      s.strstart++;

      if (bflush) {
        /*** FLUSH_BLOCK(s, 0); ***/
        flush_block_only(s, false);
        if (s.strm.avail_out === 0) {
          return BS_NEED_MORE;
        }
        /***/
      }

    } else if (s.match_available) {
      /* If there was no match at the previous position, output a
       * single literal. If there was a match but the current match
       * is longer, truncate the previous match to a single literal.
       */
      //Tracevv((stderr,"%c", s->window[s->strstart-1]));
      /*** _tr_tally_lit(s, s.window[s.strstart-1], bflush); ***/
      bflush = _tr_tally(s, 0, s.window[s.strstart - 1]);

      if (bflush) {
        /*** FLUSH_BLOCK_ONLY(s, 0) ***/
        flush_block_only(s, false);
        /***/
      }
      s.strstart++;
      s.lookahead--;
      if (s.strm.avail_out === 0) {
        return BS_NEED_MORE;
      }
    } else {
      /* There is no previous match to compare with, wait for
       * the next step to decide.
       */
      s.match_available = 1;
      s.strstart++;
      s.lookahead--;
    }
  }
  //Assert (flush != Z_NO_FLUSH, "no flush?");
  if (s.match_available) {
    //Tracevv((stderr,"%c", s->window[s->strstart-1]));
    /*** _tr_tally_lit(s, s.window[s.strstart-1], bflush); ***/
    bflush = _tr_tally(s, 0, s.window[s.strstart - 1]);

    s.match_available = 0;
  }
  s.insert = s.strstart < MIN_MATCH - 1 ? s.strstart : MIN_MATCH - 1;
  if (flush === Z_FINISH) {
    /*** FLUSH_BLOCK(s, 1); ***/
    flush_block_only(s, true);
    if (s.strm.avail_out === 0) {
      return BS_FINISH_STARTED;
    }
    /***/
    return BS_FINISH_DONE;
  }
  if (s.last_lit) {
    /*** FLUSH_BLOCK(s, 0); ***/
    flush_block_only(s, false);
    if (s.strm.avail_out === 0) {
      return BS_NEED_MORE;
    }
    /***/
  }

  return BS_BLOCK_DONE;
};


/* ===========================================================================
 * For Z_RLE, simply look for runs of bytes, generate matches only of distance
 * one.  Do not maintain a hash table.  (It will be regenerated if this run of
 * deflate switches away from Z_RLE.)
 */
const deflate_rle = (s, flush) => {

  let bflush;            /* set if current block must be flushed */
  let prev;              /* byte at distance one to match */
  let scan, strend;      /* scan goes up to strend for length of run */

  const _win = s.window;

  for (;;) {
    /* Make sure that we always have enough lookahead, except
     * at the end of the input file. We need MAX_MATCH bytes
     * for the longest run, plus one for the unrolled loop.
     */
    if (s.lookahead <= MAX_MATCH) {
      fill_window(s);
      if (s.lookahead <= MAX_MATCH && flush === Z_NO_FLUSH) {
        return BS_NEED_MORE;
      }
      if (s.lookahead === 0) { break; } /* flush the current block */
    }

    /* See how many times the previous byte repeats */
    s.match_length = 0;
    if (s.lookahead >= MIN_MATCH && s.strstart > 0) {
      scan = s.strstart - 1;
      prev = _win[scan];
      if (prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan]) {
        strend = s.strstart + MAX_MATCH;
        do {
          /*jshint noempty:false*/
        } while (prev === _win[++scan] && prev === _win[++scan] &&
                 prev === _win[++scan] && prev === _win[++scan] &&
                 prev === _win[++scan] && prev === _win[++scan] &&
                 prev === _win[++scan] && prev === _win[++scan] &&
                 scan < strend);
        s.match_length = MAX_MATCH - (strend - scan);
        if (s.match_length > s.lookahead) {
          s.match_length = s.lookahead;
        }
      }
      //Assert(scan <= s->window+(uInt)(s->window_size-1), "wild scan");
    }

    /* Emit match if have run of MIN_MATCH or longer, else emit literal */
    if (s.match_length >= MIN_MATCH) {
      //check_match(s, s.strstart, s.strstart - 1, s.match_length);

      /*** _tr_tally_dist(s, 1, s.match_length - MIN_MATCH, bflush); ***/
      bflush = _tr_tally(s, 1, s.match_length - MIN_MATCH);

      s.lookahead -= s.match_length;
      s.strstart += s.match_length;
      s.match_length = 0;
    } else {
      /* No match, output a literal byte */
      //Tracevv((stderr,"%c", s->window[s->strstart]));
      /*** _tr_tally_lit(s, s.window[s.strstart], bflush); ***/
      bflush = _tr_tally(s, 0, s.window[s.strstart]);

      s.lookahead--;
      s.strstart++;
    }
    if (bflush) {
      /*** FLUSH_BLOCK(s, 0); ***/
      flush_block_only(s, false);
      if (s.strm.avail_out === 0) {
        return BS_NEED_MORE;
      }
      /***/
    }
  }
  s.insert = 0;
  if (flush === Z_FINISH) {
    /*** FLUSH_BLOCK(s, 1); ***/
    flush_block_only(s, true);
    if (s.strm.avail_out === 0) {
      return BS_FINISH_STARTED;
    }
    /***/
    return BS_FINISH_DONE;
  }
  if (s.last_lit) {
    /*** FLUSH_BLOCK(s, 0); ***/
    flush_block_only(s, false);
    if (s.strm.avail_out === 0) {
      return BS_NEED_MORE;
    }
    /***/
  }
  return BS_BLOCK_DONE;
};

/* ===========================================================================
 * For Z_HUFFMAN_ONLY, do not look for matches.  Do not maintain a hash table.
 * (It will be regenerated if this run of deflate switches away from Huffman.)
 */
const deflate_huff = (s, flush) => {

  let bflush;             /* set if current block must be flushed */

  for (;;) {
    /* Make sure that we have a literal to write. */
    if (s.lookahead === 0) {
      fill_window(s);
      if (s.lookahead === 0) {
        if (flush === Z_NO_FLUSH) {
          return BS_NEED_MORE;
        }
        break;      /* flush the current block */
      }
    }

    /* Output a literal byte */
    s.match_length = 0;
    //Tracevv((stderr,"%c", s->window[s->strstart]));
    /*** _tr_tally_lit(s, s.window[s.strstart], bflush); ***/
    bflush = _tr_tally(s, 0, s.window[s.strstart]);
    s.lookahead--;
    s.strstart++;
    if (bflush) {
      /*** FLUSH_BLOCK(s, 0); ***/
      flush_block_only(s, false);
      if (s.strm.avail_out === 0) {
        return BS_NEED_MORE;
      }
      /***/
    }
  }
  s.insert = 0;
  if (flush === Z_FINISH) {
    /*** FLUSH_BLOCK(s, 1); ***/
    flush_block_only(s, true);
    if (s.strm.avail_out === 0) {
      return BS_FINISH_STARTED;
    }
    /***/
    return BS_FINISH_DONE;
  }
  if (s.last_lit) {
    /*** FLUSH_BLOCK(s, 0); ***/
    flush_block_only(s, false);
    if (s.strm.avail_out === 0) {
      return BS_NEED_MORE;
    }
    /***/
  }
  return BS_BLOCK_DONE;
};

/* Values for max_lazy_match, good_match and max_chain_length, depending on
 * the desired pack level (0..9). The values given below have been tuned to
 * exclude worst case performance for pathological files. Better values may be
 * found for specific files.
 */
function Config(good_length, max_lazy, nice_length, max_chain, func) {

  this.good_length = good_length;
  this.max_lazy = max_lazy;
  this.nice_length = nice_length;
  this.max_chain = max_chain;
  this.func = func;
}

const configuration_table = [
  /*      good lazy nice chain */
  new Config(0, 0, 0, 0, deflate_stored),          /* 0 store only */
  new Config(4, 4, 8, 4, deflate_fast),            /* 1 max speed, no lazy matches */
  new Config(4, 5, 16, 8, deflate_fast),           /* 2 */
  new Config(4, 6, 32, 32, deflate_fast),          /* 3 */

  new Config(4, 4, 16, 16, deflate_slow),          /* 4 lazy matches */
  new Config(8, 16, 32, 32, deflate_slow),         /* 5 */
  new Config(8, 16, 128, 128, deflate_slow),       /* 6 */
  new Config(8, 32, 128, 256, deflate_slow),       /* 7 */
  new Config(32, 128, 258, 1024, deflate_slow),    /* 8 */
  new Config(32, 258, 258, 4096, deflate_slow)     /* 9 max compression */
];


/* ===========================================================================
 * Initialize the "longest match" routines for a new zlib stream
 */
const lm_init = (s) => {

  s.window_size = 2 * s.w_size;

  /*** CLEAR_HASH(s); ***/
  zero(s.head); // Fill with NIL (= 0);

  /* Set the default configuration parameters:
   */
  s.max_lazy_match = configuration_table[s.level].max_lazy;
  s.good_match = configuration_table[s.level].good_length;
  s.nice_match = configuration_table[s.level].nice_length;
  s.max_chain_length = configuration_table[s.level].max_chain;

  s.strstart = 0;
  s.block_start = 0;
  s.lookahead = 0;
  s.insert = 0;
  s.match_length = s.prev_length = MIN_MATCH - 1;
  s.match_available = 0;
  s.ins_h = 0;
};


function DeflateState() {
  this.strm = null;            /* pointer back to this zlib stream */
  this.status = 0;            /* as the name implies */
  this.pending_buf = null;      /* output still pending */
  this.pending_buf_size = 0;  /* size of pending_buf */
  this.pending_out = 0;       /* next pending byte to output to the stream */
  this.pending = 0;           /* nb of bytes in the pending buffer */
  this.wrap = 0;              /* bit 0 true for zlib, bit 1 true for gzip */
  this.gzhead = null;         /* gzip header information to write */
  this.gzindex = 0;           /* where in extra, name, or comment */
  this.method = Z_DEFLATED; /* can only be DEFLATED */
  this.last_flush = -1;   /* value of flush param for previous deflate call */

  this.w_size = 0;  /* LZ77 window size (32K by default) */
  this.w_bits = 0;  /* log2(w_size)  (8..16) */
  this.w_mask = 0;  /* w_size - 1 */

  this.window = null;
  /* Sliding window. Input bytes are read into the second half of the window,
   * and move to the first half later to keep a dictionary of at least wSize
   * bytes. With this organization, matches are limited to a distance of
   * wSize-MAX_MATCH bytes, but this ensures that IO is always
   * performed with a length multiple of the block size.
   */

  this.window_size = 0;
  /* Actual size of window: 2*wSize, except when the user input buffer
   * is directly used as sliding window.
   */

  this.prev = null;
  /* Link to older string with same hash index. To limit the size of this
   * array to 64K, this link is maintained only for the last 32K strings.
   * An index in this array is thus a window index modulo 32K.
   */

  this.head = null;   /* Heads of the hash chains or NIL. */

  this.ins_h = 0;       /* hash index of string to be inserted */
  this.hash_size = 0;   /* number of elements in hash table */
  this.hash_bits = 0;   /* log2(hash_size) */
  this.hash_mask = 0;   /* hash_size-1 */

  this.hash_shift = 0;
  /* Number of bits by which ins_h must be shifted at each input
   * step. It must be such that after MIN_MATCH steps, the oldest
   * byte no longer takes part in the hash key, that is:
   *   hash_shift * MIN_MATCH >= hash_bits
   */

  this.block_start = 0;
  /* Window position at the beginning of the current output block. Gets
   * negative when the window is moved backwards.
   */

  this.match_length = 0;      /* length of best match */
  this.prev_match = 0;        /* previous match */
  this.match_available = 0;   /* set if previous match exists */
  this.strstart = 0;          /* start of string to insert */
  this.match_start = 0;       /* start of matching string */
  this.lookahead = 0;         /* number of valid bytes ahead in window */

  this.prev_length = 0;
  /* Length of the best match at previous step. Matches not greater than this
   * are discarded. This is used in the lazy match evaluation.
   */

  this.max_chain_length = 0;
  /* To speed up deflation, hash chains are never searched beyond this
   * length.  A higher limit improves compression ratio but degrades the
   * speed.
   */

  this.max_lazy_match = 0;
  /* Attempt to find a better match only when the current match is strictly
   * smaller than this value. This mechanism is used only for compression
   * levels >= 4.
   */
  // That's alias to max_lazy_match, don't use directly
  //this.max_insert_length = 0;
  /* Insert new strings in the hash table only if the match length is not
   * greater than this length. This saves time but degrades compression.
   * max_insert_length is used only for compression levels <= 3.
   */

  this.level = 0;     /* compression level (1..9) */
  this.strategy = 0;  /* favor or force Huffman coding*/

  this.good_match = 0;
  /* Use a faster search when the previous match is longer than this */

  this.nice_match = 0; /* Stop searching when current match exceeds this */

              /* used by trees.c: */

  /* Didn't use ct_data typedef below to suppress compiler warning */

  // struct ct_data_s dyn_ltree[HEAP_SIZE];   /* literal and length tree */
  // struct ct_data_s dyn_dtree[2*D_CODES+1]; /* distance tree */
  // struct ct_data_s bl_tree[2*BL_CODES+1];  /* Huffman tree for bit lengths */

  // Use flat array of DOUBLE size, with interleaved fata,
  // because JS does not support effective
  this.dyn_ltree  = new Uint16Array(HEAP_SIZE * 2);
  this.dyn_dtree  = new Uint16Array((2 * D_CODES + 1) * 2);
  this.bl_tree    = new Uint16Array((2 * BL_CODES + 1) * 2);
  zero(this.dyn_ltree);
  zero(this.dyn_dtree);
  zero(this.bl_tree);

  this.l_desc   = null;         /* desc. for literal tree */
  this.d_desc   = null;         /* desc. for distance tree */
  this.bl_desc  = null;         /* desc. for bit length tree */

  //ush bl_count[MAX_BITS+1];
  this.bl_count = new Uint16Array(MAX_BITS + 1);
  /* number of codes at each bit length for an optimal tree */

  //int heap[2*L_CODES+1];      /* heap used to build the Huffman trees */
  this.heap = new Uint16Array(2 * L_CODES + 1);  /* heap used to build the Huffman trees */
  zero(this.heap);

  this.heap_len = 0;               /* number of elements in the heap */
  this.heap_max = 0;               /* element of largest frequency */
  /* The sons of heap[n] are heap[2*n] and heap[2*n+1]. heap[0] is not used.
   * The same heap array is used to build all trees.
   */

  this.depth = new Uint16Array(2 * L_CODES + 1); //uch depth[2*L_CODES+1];
  zero(this.depth);
  /* Depth of each subtree used as tie breaker for trees of equal frequency
   */

  this.l_buf = 0;          /* buffer index for literals or lengths */

  this.lit_bufsize = 0;
  /* Size of match buffer for literals/lengths.  There are 4 reasons for
   * limiting lit_bufsize to 64K:
   *   - frequencies can be kept in 16 bit counters
   *   - if compression is not successful for the first block, all input
   *     data is still in the window so we can still emit a stored block even
   *     when input comes from standard input.  (This can also be done for
   *     all blocks if lit_bufsize is not greater than 32K.)
   *   - if compression is not successful for a file smaller than 64K, we can
   *     even emit a stored file instead of a stored block (saving 5 bytes).
   *     This is applicable only for zip (not gzip or zlib).
   *   - creating new Huffman trees less frequently may not provide fast
   *     adaptation to changes in the input data statistics. (Take for
   *     example a binary file with poorly compressible code followed by
   *     a highly compressible string table.) Smaller buffer sizes give
   *     fast adaptation but have of course the overhead of transmitting
   *     trees more frequently.
   *   - I can't count above 4
   */

  this.last_lit = 0;      /* running index in l_buf */

  this.d_buf = 0;
  /* Buffer index for distances. To simplify the code, d_buf and l_buf have
   * the same number of elements. To use different lengths, an extra flag
   * array would be necessary.
   */

  this.opt_len = 0;       /* bit length of current block with optimal trees */
  this.static_len = 0;    /* bit length of current block with static trees */
  this.matches = 0;       /* number of string matches in current block */
  this.insert = 0;        /* bytes at end of window left to insert */


  this.bi_buf = 0;
  /* Output buffer. bits are inserted starting at the bottom (least
   * significant bits).
   */
  this.bi_valid = 0;
  /* Number of valid bits in bi_buf.  All bits above the last valid bit
   * are always zero.
   */

  // Used for window memory init. We safely ignore it for JS. That makes
  // sense only for pointers and memory check tools.
  //this.high_water = 0;
  /* High water mark offset in window for initialized bytes -- bytes above
   * this are set to zero in order to avoid memory check warnings when
   * longest match routines access bytes past the input.  This is then
   * updated to the new high water mark.
   */
}


const deflateResetKeep = (strm) => {

  if (!strm || !strm.state) {
    return err(strm, Z_STREAM_ERROR);
  }

  strm.total_in = strm.total_out = 0;
  strm.data_type = Z_UNKNOWN;

  const s = strm.state;
  s.pending = 0;
  s.pending_out = 0;

  if (s.wrap < 0) {
    s.wrap = -s.wrap;
    /* was made negative by deflate(..., Z_FINISH); */
  }
  s.status = (s.wrap ? INIT_STATE : BUSY_STATE);
  strm.adler = (s.wrap === 2) ?
    0  // crc32(0, Z_NULL, 0)
  :
    1; // adler32(0, Z_NULL, 0)
  s.last_flush = Z_NO_FLUSH;
  _tr_init(s);
  return Z_OK;
};


const deflateReset = (strm) => {

  const ret = deflateResetKeep(strm);
  if (ret === Z_OK) {
    lm_init(strm.state);
  }
  return ret;
};


const deflateSetHeader = (strm, head) => {

  if (!strm || !strm.state) { return Z_STREAM_ERROR; }
  if (strm.state.wrap !== 2) { return Z_STREAM_ERROR; }
  strm.state.gzhead = head;
  return Z_OK;
};


const deflateInit2 = (strm, level, method, windowBits, memLevel, strategy) => {

  if (!strm) { // === Z_NULL
    return Z_STREAM_ERROR;
  }
  let wrap = 1;

  if (level === Z_DEFAULT_COMPRESSION) {
    level = 6;
  }

  if (windowBits < 0) { /* suppress zlib wrapper */
    wrap = 0;
    windowBits = -windowBits;
  }

  else if (windowBits > 15) {
    wrap = 2;           /* write gzip wrapper instead */
    windowBits -= 16;
  }


  if (memLevel < 1 || memLevel > MAX_MEM_LEVEL || method !== Z_DEFLATED ||
    windowBits < 8 || windowBits > 15 || level < 0 || level > 9 ||
    strategy < 0 || strategy > Z_FIXED) {
    return err(strm, Z_STREAM_ERROR);
  }


  if (windowBits === 8) {
    windowBits = 9;
  }
  /* until 256-byte window bug fixed */

  const s = new DeflateState();

  strm.state = s;
  s.strm = strm;

  s.wrap = wrap;
  s.gzhead = null;
  s.w_bits = windowBits;
  s.w_size = 1 << s.w_bits;
  s.w_mask = s.w_size - 1;

  s.hash_bits = memLevel + 7;
  s.hash_size = 1 << s.hash_bits;
  s.hash_mask = s.hash_size - 1;
  s.hash_shift = ~~((s.hash_bits + MIN_MATCH - 1) / MIN_MATCH);

  s.window = new Uint8Array(s.w_size * 2);
  s.head = new Uint16Array(s.hash_size);
  s.prev = new Uint16Array(s.w_size);

  // Don't need mem init magic for JS.
  //s.high_water = 0;  /* nothing written to s->window yet */

  s.lit_bufsize = 1 << (memLevel + 6); /* 16K elements by default */

  s.pending_buf_size = s.lit_bufsize * 4;

  //overlay = (ushf *) ZALLOC(strm, s->lit_bufsize, sizeof(ush)+2);
  //s->pending_buf = (uchf *) overlay;
  s.pending_buf = new Uint8Array(s.pending_buf_size);

  // It is offset from `s.pending_buf` (size is `s.lit_bufsize * 2`)
  //s->d_buf = overlay + s->lit_bufsize/sizeof(ush);
  s.d_buf = 1 * s.lit_bufsize;

  //s->l_buf = s->pending_buf + (1+sizeof(ush))*s->lit_bufsize;
  s.l_buf = (1 + 2) * s.lit_bufsize;

  s.level = level;
  s.strategy = strategy;
  s.method = method;

  return deflateReset(strm);
};

const deflateInit = (strm, level) => {

  return deflateInit2(strm, level, Z_DEFLATED, MAX_WBITS, DEF_MEM_LEVEL, Z_DEFAULT_STRATEGY);
};


const deflate = (strm, flush) => {

  let beg, val; // for gzip header write only

  if (!strm || !strm.state ||
    flush > Z_BLOCK || flush < 0) {
    return strm ? err(strm, Z_STREAM_ERROR) : Z_STREAM_ERROR;
  }

  const s = strm.state;

  if (!strm.output ||
      (!strm.input && strm.avail_in !== 0) ||
      (s.status === FINISH_STATE && flush !== Z_FINISH)) {
    return err(strm, (strm.avail_out === 0) ? Z_BUF_ERROR : Z_STREAM_ERROR);
  }

  s.strm = strm; /* just in case */
  const old_flush = s.last_flush;
  s.last_flush = flush;

  /* Write the header */
  if (s.status === INIT_STATE) {

    if (s.wrap === 2) { // GZIP header
      strm.adler = 0;  //crc32(0L, Z_NULL, 0);
      put_byte(s, 31);
      put_byte(s, 139);
      put_byte(s, 8);
      if (!s.gzhead) { // s->gzhead == Z_NULL
        put_byte(s, 0);
        put_byte(s, 0);
        put_byte(s, 0);
        put_byte(s, 0);
        put_byte(s, 0);
        put_byte(s, s.level === 9 ? 2 :
                    (s.strategy >= Z_HUFFMAN_ONLY || s.level < 2 ?
                     4 : 0));
        put_byte(s, OS_CODE);
        s.status = BUSY_STATE;
      }
      else {
        put_byte(s, (s.gzhead.text ? 1 : 0) +
                    (s.gzhead.hcrc ? 2 : 0) +
                    (!s.gzhead.extra ? 0 : 4) +
                    (!s.gzhead.name ? 0 : 8) +
                    (!s.gzhead.comment ? 0 : 16)
        );
        put_byte(s, s.gzhead.time & 0xff);
        put_byte(s, (s.gzhead.time >> 8) & 0xff);
        put_byte(s, (s.gzhead.time >> 16) & 0xff);
        put_byte(s, (s.gzhead.time >> 24) & 0xff);
        put_byte(s, s.level === 9 ? 2 :
                    (s.strategy >= Z_HUFFMAN_ONLY || s.level < 2 ?
                     4 : 0));
        put_byte(s, s.gzhead.os & 0xff);
        if (s.gzhead.extra && s.gzhead.extra.length) {
          put_byte(s, s.gzhead.extra.length & 0xff);
          put_byte(s, (s.gzhead.extra.length >> 8) & 0xff);
        }
        if (s.gzhead.hcrc) {
          strm.adler = crc32(strm.adler, s.pending_buf, s.pending, 0);
        }
        s.gzindex = 0;
        s.status = EXTRA_STATE;
      }
    }
    else // DEFLATE header
    {
      let header = (Z_DEFLATED + ((s.w_bits - 8) << 4)) << 8;
      let level_flags = -1;

      if (s.strategy >= Z_HUFFMAN_ONLY || s.level < 2) {
        level_flags = 0;
      } else if (s.level < 6) {
        level_flags = 1;
      } else if (s.level === 6) {
        level_flags = 2;
      } else {
        level_flags = 3;
      }
      header |= (level_flags << 6);
      if (s.strstart !== 0) { header |= PRESET_DICT; }
      header += 31 - (header % 31);

      s.status = BUSY_STATE;
      putShortMSB(s, header);

      /* Save the adler32 of the preset dictionary: */
      if (s.strstart !== 0) {
        putShortMSB(s, strm.adler >>> 16);
        putShortMSB(s, strm.adler & 0xffff);
      }
      strm.adler = 1; // adler32(0L, Z_NULL, 0);
    }
  }

//#ifdef GZIP
  if (s.status === EXTRA_STATE) {
    if (s.gzhead.extra/* != Z_NULL*/) {
      beg = s.pending;  /* start of bytes to update crc */

      while (s.gzindex < (s.gzhead.extra.length & 0xffff)) {
        if (s.pending === s.pending_buf_size) {
          if (s.gzhead.hcrc && s.pending > beg) {
            strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
          }
          flush_pending(strm);
          beg = s.pending;
          if (s.pending === s.pending_buf_size) {
            break;
          }
        }
        put_byte(s, s.gzhead.extra[s.gzindex] & 0xff);
        s.gzindex++;
      }
      if (s.gzhead.hcrc && s.pending > beg) {
        strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
      }
      if (s.gzindex === s.gzhead.extra.length) {
        s.gzindex = 0;
        s.status = NAME_STATE;
      }
    }
    else {
      s.status = NAME_STATE;
    }
  }
  if (s.status === NAME_STATE) {
    if (s.gzhead.name/* != Z_NULL*/) {
      beg = s.pending;  /* start of bytes to update crc */
      //int val;

      do {
        if (s.pending === s.pending_buf_size) {
          if (s.gzhead.hcrc && s.pending > beg) {
            strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
          }
          flush_pending(strm);
          beg = s.pending;
          if (s.pending === s.pending_buf_size) {
            val = 1;
            break;
          }
        }
        // JS specific: little magic to add zero terminator to end of string
        if (s.gzindex < s.gzhead.name.length) {
          val = s.gzhead.name.charCodeAt(s.gzindex++) & 0xff;
        } else {
          val = 0;
        }
        put_byte(s, val);
      } while (val !== 0);

      if (s.gzhead.hcrc && s.pending > beg) {
        strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
      }
      if (val === 0) {
        s.gzindex = 0;
        s.status = COMMENT_STATE;
      }
    }
    else {
      s.status = COMMENT_STATE;
    }
  }
  if (s.status === COMMENT_STATE) {
    if (s.gzhead.comment/* != Z_NULL*/) {
      beg = s.pending;  /* start of bytes to update crc */
      //int val;

      do {
        if (s.pending === s.pending_buf_size) {
          if (s.gzhead.hcrc && s.pending > beg) {
            strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
          }
          flush_pending(strm);
          beg = s.pending;
          if (s.pending === s.pending_buf_size) {
            val = 1;
            break;
          }
        }
        // JS specific: little magic to add zero terminator to end of string
        if (s.gzindex < s.gzhead.comment.length) {
          val = s.gzhead.comment.charCodeAt(s.gzindex++) & 0xff;
        } else {
          val = 0;
        }
        put_byte(s, val);
      } while (val !== 0);

      if (s.gzhead.hcrc && s.pending > beg) {
        strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
      }
      if (val === 0) {
        s.status = HCRC_STATE;
      }
    }
    else {
      s.status = HCRC_STATE;
    }
  }
  if (s.status === HCRC_STATE) {
    if (s.gzhead.hcrc) {
      if (s.pending + 2 > s.pending_buf_size) {
        flush_pending(strm);
      }
      if (s.pending + 2 <= s.pending_buf_size) {
        put_byte(s, strm.adler & 0xff);
        put_byte(s, (strm.adler >> 8) & 0xff);
        strm.adler = 0; //crc32(0L, Z_NULL, 0);
        s.status = BUSY_STATE;
      }
    }
    else {
      s.status = BUSY_STATE;
    }
  }
//#endif

  /* Flush as much pending output as possible */
  if (s.pending !== 0) {
    flush_pending(strm);
    if (strm.avail_out === 0) {
      /* Since avail_out is 0, deflate will be called again with
       * more output space, but possibly with both pending and
       * avail_in equal to zero. There won't be anything to do,
       * but this is not an error situation so make sure we
       * return OK instead of BUF_ERROR at next call of deflate:
       */
      s.last_flush = -1;
      return Z_OK;
    }

    /* Make sure there is something to do and avoid duplicate consecutive
     * flushes. For repeated and useless calls with Z_FINISH, we keep
     * returning Z_STREAM_END instead of Z_BUF_ERROR.
     */
  } else if (strm.avail_in === 0 && rank(flush) <= rank(old_flush) &&
    flush !== Z_FINISH) {
    return err(strm, Z_BUF_ERROR);
  }

  /* User must not provide more input after the first FINISH: */
  if (s.status === FINISH_STATE && strm.avail_in !== 0) {
    return err(strm, Z_BUF_ERROR);
  }

  /* Start a new block or continue the current one.
   */
  if (strm.avail_in !== 0 || s.lookahead !== 0 ||
    (flush !== Z_NO_FLUSH && s.status !== FINISH_STATE)) {
    let bstate = (s.strategy === Z_HUFFMAN_ONLY) ? deflate_huff(s, flush) :
      (s.strategy === Z_RLE ? deflate_rle(s, flush) :
        configuration_table[s.level].func(s, flush));

    if (bstate === BS_FINISH_STARTED || bstate === BS_FINISH_DONE) {
      s.status = FINISH_STATE;
    }
    if (bstate === BS_NEED_MORE || bstate === BS_FINISH_STARTED) {
      if (strm.avail_out === 0) {
        s.last_flush = -1;
        /* avoid BUF_ERROR next call, see above */
      }
      return Z_OK;
      /* If flush != Z_NO_FLUSH && avail_out == 0, the next call
       * of deflate should use the same flush parameter to make sure
       * that the flush is complete. So we don't have to output an
       * empty block here, this will be done at next call. This also
       * ensures that for a very small output buffer, we emit at most
       * one empty block.
       */
    }
    if (bstate === BS_BLOCK_DONE) {
      if (flush === Z_PARTIAL_FLUSH) {
        _tr_align(s);
      }
      else if (flush !== Z_BLOCK) { /* FULL_FLUSH or SYNC_FLUSH */

        _tr_stored_block(s, 0, 0, false);
        /* For a full flush, this empty block will be recognized
         * as a special marker by inflate_sync().
         */
        if (flush === Z_FULL_FLUSH) {
          /*** CLEAR_HASH(s); ***/             /* forget history */
          zero(s.head); // Fill with NIL (= 0);

          if (s.lookahead === 0) {
            s.strstart = 0;
            s.block_start = 0;
            s.insert = 0;
          }
        }
      }
      flush_pending(strm);
      if (strm.avail_out === 0) {
        s.last_flush = -1; /* avoid BUF_ERROR at next call, see above */
        return Z_OK;
      }
    }
  }
  //Assert(strm->avail_out > 0, "bug2");
  //if (strm.avail_out <= 0) { throw new Error("bug2");}

  if (flush !== Z_FINISH) { return Z_OK; }
  if (s.wrap <= 0) { return Z_STREAM_END; }

  /* Write the trailer */
  if (s.wrap === 2) {
    put_byte(s, strm.adler & 0xff);
    put_byte(s, (strm.adler >> 8) & 0xff);
    put_byte(s, (strm.adler >> 16) & 0xff);
    put_byte(s, (strm.adler >> 24) & 0xff);
    put_byte(s, strm.total_in & 0xff);
    put_byte(s, (strm.total_in >> 8) & 0xff);
    put_byte(s, (strm.total_in >> 16) & 0xff);
    put_byte(s, (strm.total_in >> 24) & 0xff);
  }
  else
  {
    putShortMSB(s, strm.adler >>> 16);
    putShortMSB(s, strm.adler & 0xffff);
  }

  flush_pending(strm);
  /* If avail_out is zero, the application will call deflate again
   * to flush the rest.
   */
  if (s.wrap > 0) { s.wrap = -s.wrap; }
  /* write the trailer only once! */
  return s.pending !== 0 ? Z_OK : Z_STREAM_END;
};


const deflateEnd = (strm) => {

  if (!strm/*== Z_NULL*/ || !strm.state/*== Z_NULL*/) {
    return Z_STREAM_ERROR;
  }

  const status = strm.state.status;
  if (status !== INIT_STATE &&
    status !== EXTRA_STATE &&
    status !== NAME_STATE &&
    status !== COMMENT_STATE &&
    status !== HCRC_STATE &&
    status !== BUSY_STATE &&
    status !== FINISH_STATE
  ) {
    return err(strm, Z_STREAM_ERROR);
  }

  strm.state = null;

  return status === BUSY_STATE ? err(strm, Z_DATA_ERROR) : Z_OK;
};


/* =========================================================================
 * Initializes the compression dictionary from the given byte
 * sequence without producing any compressed output.
 */
const deflateSetDictionary = (strm, dictionary) => {

  let dictLength = dictionary.length;

  if (!strm/*== Z_NULL*/ || !strm.state/*== Z_NULL*/) {
    return Z_STREAM_ERROR;
  }

  const s = strm.state;
  const wrap = s.wrap;

  if (wrap === 2 || (wrap === 1 && s.status !== INIT_STATE) || s.lookahead) {
    return Z_STREAM_ERROR;
  }

  /* when using zlib wrappers, compute Adler-32 for provided dictionary */
  if (wrap === 1) {
    /* adler32(strm->adler, dictionary, dictLength); */
    strm.adler = adler32(strm.adler, dictionary, dictLength, 0);
  }

  s.wrap = 0;   /* avoid computing Adler-32 in read_buf */

  /* if dictionary would fill window, just replace the history */
  if (dictLength >= s.w_size) {
    if (wrap === 0) {            /* already empty otherwise */
      /*** CLEAR_HASH(s); ***/
      zero(s.head); // Fill with NIL (= 0);
      s.strstart = 0;
      s.block_start = 0;
      s.insert = 0;
    }
    /* use the tail */
    // dictionary = dictionary.slice(dictLength - s.w_size);
    let tmpDict = new Uint8Array(s.w_size);
    tmpDict.set(dictionary.subarray(dictLength - s.w_size, dictLength), 0);
    dictionary = tmpDict;
    dictLength = s.w_size;
  }
  /* insert dictionary into window and hash */
  const avail = strm.avail_in;
  const next = strm.next_in;
  const input = strm.input;
  strm.avail_in = dictLength;
  strm.next_in = 0;
  strm.input = dictionary;
  fill_window(s);
  while (s.lookahead >= MIN_MATCH) {
    let str = s.strstart;
    let n = s.lookahead - (MIN_MATCH - 1);
    do {
      /* UPDATE_HASH(s, s->ins_h, s->window[str + MIN_MATCH-1]); */
      s.ins_h = HASH(s, s.ins_h, s.window[str + MIN_MATCH - 1]);

      s.prev[str & s.w_mask] = s.head[s.ins_h];

      s.head[s.ins_h] = str;
      str++;
    } while (--n);
    s.strstart = str;
    s.lookahead = MIN_MATCH - 1;
    fill_window(s);
  }
  s.strstart += s.lookahead;
  s.block_start = s.strstart;
  s.insert = s.lookahead;
  s.lookahead = 0;
  s.match_length = s.prev_length = MIN_MATCH - 1;
  s.match_available = 0;
  strm.next_in = next;
  strm.input = input;
  strm.avail_in = avail;
  s.wrap = wrap;
  return Z_OK;
};


module.exports.deflateInit = deflateInit;
module.exports.deflateInit2 = deflateInit2;
module.exports.deflateReset = deflateReset;
module.exports.deflateResetKeep = deflateResetKeep;
module.exports.deflateSetHeader = deflateSetHeader;
module.exports.deflate = deflate;
module.exports.deflateEnd = deflateEnd;
module.exports.deflateSetDictionary = deflateSetDictionary;
module.exports.deflateInfo = 'pako deflate (from Nodeca project)';

/* Not implemented
module.exports.deflateBound = deflateBound;
module.exports.deflateCopy = deflateCopy;
module.exports.deflateParams = deflateParams;
module.exports.deflatePending = deflatePending;
module.exports.deflatePrime = deflatePrime;
module.exports.deflateTune = deflateTune;
*/


/***/ }),

/***/ "./node_modules/pako/lib/zlib/gzheader.js":
/*!************************************************!*\
  !*** ./node_modules/pako/lib/zlib/gzheader.js ***!
  \************************************************/
/***/ (function(module) {

"use strict";


// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

function GZheader() {
  /* true if compressed data believed to be text */
  this.text       = 0;
  /* modification time */
  this.time       = 0;
  /* extra flags (not used when writing a gzip file) */
  this.xflags     = 0;
  /* operating system */
  this.os         = 0;
  /* pointer to extra field or Z_NULL if none */
  this.extra      = null;
  /* extra field length (valid if extra != Z_NULL) */
  this.extra_len  = 0; // Actually, we don't need it in JS,
                       // but leave for few code modifications

  //
  // Setup limits is not necessary because in js we should not preallocate memory
  // for inflate use constant limit in 65536 bytes
  //

  /* space at extra (only when reading header) */
  // this.extra_max  = 0;
  /* pointer to zero-terminated file name or Z_NULL */
  this.name       = '';
  /* space at name (only when reading header) */
  // this.name_max   = 0;
  /* pointer to zero-terminated comment or Z_NULL */
  this.comment    = '';
  /* space at comment (only when reading header) */
  // this.comm_max   = 0;
  /* true if there was or will be a header crc */
  this.hcrc       = 0;
  /* true when done reading gzip header (not used when writing a gzip file) */
  this.done       = false;
}

module.exports = GZheader;


/***/ }),

/***/ "./node_modules/pako/lib/zlib/inffast.js":
/*!***********************************************!*\
  !*** ./node_modules/pako/lib/zlib/inffast.js ***!
  \***********************************************/
/***/ (function(module) {

"use strict";


// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

// See state defs from inflate.js
const BAD = 30;       /* got a data error -- remain here until reset */
const TYPE = 12;      /* i: waiting for type bits, including last-flag bit */

/*
   Decode literal, length, and distance codes and write out the resulting
   literal and match bytes until either not enough input or output is
   available, an end-of-block is encountered, or a data error is encountered.
   When large enough input and output buffers are supplied to inflate(), for
   example, a 16K input buffer and a 64K output buffer, more than 95% of the
   inflate execution time is spent in this routine.

   Entry assumptions:

        state.mode === LEN
        strm.avail_in >= 6
        strm.avail_out >= 258
        start >= strm.avail_out
        state.bits < 8

   On return, state.mode is one of:

        LEN -- ran out of enough output space or enough available input
        TYPE -- reached end of block code, inflate() to interpret next block
        BAD -- error in block data

   Notes:

    - The maximum input bits used by a length/distance pair is 15 bits for the
      length code, 5 bits for the length extra, 15 bits for the distance code,
      and 13 bits for the distance extra.  This totals 48 bits, or six bytes.
      Therefore if strm.avail_in >= 6, then there is enough input to avoid
      checking for available input while decoding.

    - The maximum bytes that a single length/distance pair can output is 258
      bytes, which is the maximum length that can be coded.  inflate_fast()
      requires strm.avail_out >= 258 for each loop to avoid checking for
      output space.
 */
module.exports = function inflate_fast(strm, start) {
  let _in;                    /* local strm.input */
  let last;                   /* have enough input while in < last */
  let _out;                   /* local strm.output */
  let beg;                    /* inflate()'s initial strm.output */
  let end;                    /* while out < end, enough space available */
//#ifdef INFLATE_STRICT
  let dmax;                   /* maximum distance from zlib header */
//#endif
  let wsize;                  /* window size or zero if not using window */
  let whave;                  /* valid bytes in the window */
  let wnext;                  /* window write index */
  // Use `s_window` instead `window`, avoid conflict with instrumentation tools
  let s_window;               /* allocated sliding window, if wsize != 0 */
  let hold;                   /* local strm.hold */
  let bits;                   /* local strm.bits */
  let lcode;                  /* local strm.lencode */
  let dcode;                  /* local strm.distcode */
  let lmask;                  /* mask for first level of length codes */
  let dmask;                  /* mask for first level of distance codes */
  let here;                   /* retrieved table entry */
  let op;                     /* code bits, operation, extra bits, or */
                              /*  window position, window bytes to copy */
  let len;                    /* match length, unused bytes */
  let dist;                   /* match distance */
  let from;                   /* where to copy match from */
  let from_source;


  let input, output; // JS specific, because we have no pointers

  /* copy state to local variables */
  const state = strm.state;
  //here = state.here;
  _in = strm.next_in;
  input = strm.input;
  last = _in + (strm.avail_in - 5);
  _out = strm.next_out;
  output = strm.output;
  beg = _out - (start - strm.avail_out);
  end = _out + (strm.avail_out - 257);
//#ifdef INFLATE_STRICT
  dmax = state.dmax;
//#endif
  wsize = state.wsize;
  whave = state.whave;
  wnext = state.wnext;
  s_window = state.window;
  hold = state.hold;
  bits = state.bits;
  lcode = state.lencode;
  dcode = state.distcode;
  lmask = (1 << state.lenbits) - 1;
  dmask = (1 << state.distbits) - 1;


  /* decode literals and length/distances until end-of-block or not enough
     input data or output space */

  top:
  do {
    if (bits < 15) {
      hold += input[_in++] << bits;
      bits += 8;
      hold += input[_in++] << bits;
      bits += 8;
    }

    here = lcode[hold & lmask];

    dolen:
    for (;;) { // Goto emulation
      op = here >>> 24/*here.bits*/;
      hold >>>= op;
      bits -= op;
      op = (here >>> 16) & 0xff/*here.op*/;
      if (op === 0) {                          /* literal */
        //Tracevv((stderr, here.val >= 0x20 && here.val < 0x7f ?
        //        "inflate:         literal '%c'\n" :
        //        "inflate:         literal 0x%02x\n", here.val));
        output[_out++] = here & 0xffff/*here.val*/;
      }
      else if (op & 16) {                     /* length base */
        len = here & 0xffff/*here.val*/;
        op &= 15;                           /* number of extra bits */
        if (op) {
          if (bits < op) {
            hold += input[_in++] << bits;
            bits += 8;
          }
          len += hold & ((1 << op) - 1);
          hold >>>= op;
          bits -= op;
        }
        //Tracevv((stderr, "inflate:         length %u\n", len));
        if (bits < 15) {
          hold += input[_in++] << bits;
          bits += 8;
          hold += input[_in++] << bits;
          bits += 8;
        }
        here = dcode[hold & dmask];

        dodist:
        for (;;) { // goto emulation
          op = here >>> 24/*here.bits*/;
          hold >>>= op;
          bits -= op;
          op = (here >>> 16) & 0xff/*here.op*/;

          if (op & 16) {                      /* distance base */
            dist = here & 0xffff/*here.val*/;
            op &= 15;                       /* number of extra bits */
            if (bits < op) {
              hold += input[_in++] << bits;
              bits += 8;
              if (bits < op) {
                hold += input[_in++] << bits;
                bits += 8;
              }
            }
            dist += hold & ((1 << op) - 1);
//#ifdef INFLATE_STRICT
            if (dist > dmax) {
              strm.msg = 'invalid distance too far back';
              state.mode = BAD;
              break top;
            }
//#endif
            hold >>>= op;
            bits -= op;
            //Tracevv((stderr, "inflate:         distance %u\n", dist));
            op = _out - beg;                /* max distance in output */
            if (dist > op) {                /* see if copy from window */
              op = dist - op;               /* distance back in window */
              if (op > whave) {
                if (state.sane) {
                  strm.msg = 'invalid distance too far back';
                  state.mode = BAD;
                  break top;
                }

// (!) This block is disabled in zlib defaults,
// don't enable it for binary compatibility
//#ifdef INFLATE_ALLOW_INVALID_DISTANCE_TOOFAR_ARRR
//                if (len <= op - whave) {
//                  do {
//                    output[_out++] = 0;
//                  } while (--len);
//                  continue top;
//                }
//                len -= op - whave;
//                do {
//                  output[_out++] = 0;
//                } while (--op > whave);
//                if (op === 0) {
//                  from = _out - dist;
//                  do {
//                    output[_out++] = output[from++];
//                  } while (--len);
//                  continue top;
//                }
//#endif
              }
              from = 0; // window index
              from_source = s_window;
              if (wnext === 0) {           /* very common case */
                from += wsize - op;
                if (op < len) {         /* some from window */
                  len -= op;
                  do {
                    output[_out++] = s_window[from++];
                  } while (--op);
                  from = _out - dist;  /* rest from output */
                  from_source = output;
                }
              }
              else if (wnext < op) {      /* wrap around window */
                from += wsize + wnext - op;
                op -= wnext;
                if (op < len) {         /* some from end of window */
                  len -= op;
                  do {
                    output[_out++] = s_window[from++];
                  } while (--op);
                  from = 0;
                  if (wnext < len) {  /* some from start of window */
                    op = wnext;
                    len -= op;
                    do {
                      output[_out++] = s_window[from++];
                    } while (--op);
                    from = _out - dist;      /* rest from output */
                    from_source = output;
                  }
                }
              }
              else {                      /* contiguous in window */
                from += wnext - op;
                if (op < len) {         /* some from window */
                  len -= op;
                  do {
                    output[_out++] = s_window[from++];
                  } while (--op);
                  from = _out - dist;  /* rest from output */
                  from_source = output;
                }
              }
              while (len > 2) {
                output[_out++] = from_source[from++];
                output[_out++] = from_source[from++];
                output[_out++] = from_source[from++];
                len -= 3;
              }
              if (len) {
                output[_out++] = from_source[from++];
                if (len > 1) {
                  output[_out++] = from_source[from++];
                }
              }
            }
            else {
              from = _out - dist;          /* copy direct from output */
              do {                        /* minimum length is three */
                output[_out++] = output[from++];
                output[_out++] = output[from++];
                output[_out++] = output[from++];
                len -= 3;
              } while (len > 2);
              if (len) {
                output[_out++] = output[from++];
                if (len > 1) {
                  output[_out++] = output[from++];
                }
              }
            }
          }
          else if ((op & 64) === 0) {          /* 2nd level distance code */
            here = dcode[(here & 0xffff)/*here.val*/ + (hold & ((1 << op) - 1))];
            continue dodist;
          }
          else {
            strm.msg = 'invalid distance code';
            state.mode = BAD;
            break top;
          }

          break; // need to emulate goto via "continue"
        }
      }
      else if ((op & 64) === 0) {              /* 2nd level length code */
        here = lcode[(here & 0xffff)/*here.val*/ + (hold & ((1 << op) - 1))];
        continue dolen;
      }
      else if (op & 32) {                     /* end-of-block */
        //Tracevv((stderr, "inflate:         end of block\n"));
        state.mode = TYPE;
        break top;
      }
      else {
        strm.msg = 'invalid literal/length code';
        state.mode = BAD;
        break top;
      }

      break; // need to emulate goto via "continue"
    }
  } while (_in < last && _out < end);

  /* return unused bytes (on entry, bits < 8, so in won't go too far back) */
  len = bits >> 3;
  _in -= len;
  bits -= len << 3;
  hold &= (1 << bits) - 1;

  /* update state and return */
  strm.next_in = _in;
  strm.next_out = _out;
  strm.avail_in = (_in < last ? 5 + (last - _in) : 5 - (_in - last));
  strm.avail_out = (_out < end ? 257 + (end - _out) : 257 - (_out - end));
  state.hold = hold;
  state.bits = bits;
  return;
};


/***/ }),

/***/ "./node_modules/pako/lib/zlib/inflate.js":
/*!***********************************************!*\
  !*** ./node_modules/pako/lib/zlib/inflate.js ***!
  \***********************************************/
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";


// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

const adler32       = __webpack_require__(/*! ./adler32 */ "./node_modules/pako/lib/zlib/adler32.js");
const crc32         = __webpack_require__(/*! ./crc32 */ "./node_modules/pako/lib/zlib/crc32.js");
const inflate_fast  = __webpack_require__(/*! ./inffast */ "./node_modules/pako/lib/zlib/inffast.js");
const inflate_table = __webpack_require__(/*! ./inftrees */ "./node_modules/pako/lib/zlib/inftrees.js");

const CODES = 0;
const LENS = 1;
const DISTS = 2;

/* Public constants ==========================================================*/
/* ===========================================================================*/

const {
  Z_FINISH, Z_BLOCK, Z_TREES,
  Z_OK, Z_STREAM_END, Z_NEED_DICT, Z_STREAM_ERROR, Z_DATA_ERROR, Z_MEM_ERROR, Z_BUF_ERROR,
  Z_DEFLATED
} = __webpack_require__(/*! ./constants */ "./node_modules/pako/lib/zlib/constants.js");


/* STATES ====================================================================*/
/* ===========================================================================*/


const    HEAD = 1;       /* i: waiting for magic header */
const    FLAGS = 2;      /* i: waiting for method and flags (gzip) */
const    TIME = 3;       /* i: waiting for modification time (gzip) */
const    OS = 4;         /* i: waiting for extra flags and operating system (gzip) */
const    EXLEN = 5;      /* i: waiting for extra length (gzip) */
const    EXTRA = 6;      /* i: waiting for extra bytes (gzip) */
const    NAME = 7;       /* i: waiting for end of file name (gzip) */
const    COMMENT = 8;    /* i: waiting for end of comment (gzip) */
const    HCRC = 9;       /* i: waiting for header crc (gzip) */
const    DICTID = 10;    /* i: waiting for dictionary check value */
const    DICT = 11;      /* waiting for inflateSetDictionary() call */
const        TYPE = 12;      /* i: waiting for type bits, including last-flag bit */
const        TYPEDO = 13;    /* i: same, but skip check to exit inflate on new block */
const        STORED = 14;    /* i: waiting for stored size (length and complement) */
const        COPY_ = 15;     /* i/o: same as COPY below, but only first time in */
const        COPY = 16;      /* i/o: waiting for input or output to copy stored block */
const        TABLE = 17;     /* i: waiting for dynamic block table lengths */
const        LENLENS = 18;   /* i: waiting for code length code lengths */
const        CODELENS = 19;  /* i: waiting for length/lit and distance code lengths */
const            LEN_ = 20;      /* i: same as LEN below, but only first time in */
const            LEN = 21;       /* i: waiting for length/lit/eob code */
const            LENEXT = 22;    /* i: waiting for length extra bits */
const            DIST = 23;      /* i: waiting for distance code */
const            DISTEXT = 24;   /* i: waiting for distance extra bits */
const            MATCH = 25;     /* o: waiting for output space to copy string */
const            LIT = 26;       /* o: waiting for output space to write literal */
const    CHECK = 27;     /* i: waiting for 32-bit check value */
const    LENGTH = 28;    /* i: waiting for 32-bit length (gzip) */
const    DONE = 29;      /* finished check, done -- remain here until reset */
const    BAD = 30;       /* got a data error -- remain here until reset */
const    MEM = 31;       /* got an inflate() memory error -- remain here until reset */
const    SYNC = 32;      /* looking for synchronization bytes to restart inflate() */

/* ===========================================================================*/



const ENOUGH_LENS = 852;
const ENOUGH_DISTS = 592;
//const ENOUGH =  (ENOUGH_LENS+ENOUGH_DISTS);

const MAX_WBITS = 15;
/* 32K LZ77 window */
const DEF_WBITS = MAX_WBITS;


const zswap32 = (q) => {

  return  (((q >>> 24) & 0xff) +
          ((q >>> 8) & 0xff00) +
          ((q & 0xff00) << 8) +
          ((q & 0xff) << 24));
};


function InflateState() {
  this.mode = 0;             /* current inflate mode */
  this.last = false;          /* true if processing last block */
  this.wrap = 0;              /* bit 0 true for zlib, bit 1 true for gzip */
  this.havedict = false;      /* true if dictionary provided */
  this.flags = 0;             /* gzip header method and flags (0 if zlib) */
  this.dmax = 0;              /* zlib header max distance (INFLATE_STRICT) */
  this.check = 0;             /* protected copy of check value */
  this.total = 0;             /* protected copy of output count */
  // TODO: may be {}
  this.head = null;           /* where to save gzip header information */

  /* sliding window */
  this.wbits = 0;             /* log base 2 of requested window size */
  this.wsize = 0;             /* window size or zero if not using window */
  this.whave = 0;             /* valid bytes in the window */
  this.wnext = 0;             /* window write index */
  this.window = null;         /* allocated sliding window, if needed */

  /* bit accumulator */
  this.hold = 0;              /* input bit accumulator */
  this.bits = 0;              /* number of bits in "in" */

  /* for string and stored block copying */
  this.length = 0;            /* literal or length of data to copy */
  this.offset = 0;            /* distance back to copy string from */

  /* for table and code decoding */
  this.extra = 0;             /* extra bits needed */

  /* fixed and dynamic code tables */
  this.lencode = null;          /* starting table for length/literal codes */
  this.distcode = null;         /* starting table for distance codes */
  this.lenbits = 0;           /* index bits for lencode */
  this.distbits = 0;          /* index bits for distcode */

  /* dynamic table building */
  this.ncode = 0;             /* number of code length code lengths */
  this.nlen = 0;              /* number of length code lengths */
  this.ndist = 0;             /* number of distance code lengths */
  this.have = 0;              /* number of code lengths in lens[] */
  this.next = null;              /* next available space in codes[] */

  this.lens = new Uint16Array(320); /* temporary storage for code lengths */
  this.work = new Uint16Array(288); /* work area for code table building */

  /*
   because we don't have pointers in js, we use lencode and distcode directly
   as buffers so we don't need codes
  */
  //this.codes = new Int32Array(ENOUGH);       /* space for code tables */
  this.lendyn = null;              /* dynamic table for length/literal codes (JS specific) */
  this.distdyn = null;             /* dynamic table for distance codes (JS specific) */
  this.sane = 0;                   /* if false, allow invalid distance too far */
  this.back = 0;                   /* bits back of last unprocessed length/lit */
  this.was = 0;                    /* initial length of match */
}


const inflateResetKeep = (strm) => {

  if (!strm || !strm.state) { return Z_STREAM_ERROR; }
  const state = strm.state;
  strm.total_in = strm.total_out = state.total = 0;
  strm.msg = ''; /*Z_NULL*/
  if (state.wrap) {       /* to support ill-conceived Java test suite */
    strm.adler = state.wrap & 1;
  }
  state.mode = HEAD;
  state.last = 0;
  state.havedict = 0;
  state.dmax = 32768;
  state.head = null/*Z_NULL*/;
  state.hold = 0;
  state.bits = 0;
  //state.lencode = state.distcode = state.next = state.codes;
  state.lencode = state.lendyn = new Int32Array(ENOUGH_LENS);
  state.distcode = state.distdyn = new Int32Array(ENOUGH_DISTS);

  state.sane = 1;
  state.back = -1;
  //Tracev((stderr, "inflate: reset\n"));
  return Z_OK;
};


const inflateReset = (strm) => {

  if (!strm || !strm.state) { return Z_STREAM_ERROR; }
  const state = strm.state;
  state.wsize = 0;
  state.whave = 0;
  state.wnext = 0;
  return inflateResetKeep(strm);

};


const inflateReset2 = (strm, windowBits) => {
  let wrap;

  /* get the state */
  if (!strm || !strm.state) { return Z_STREAM_ERROR; }
  const state = strm.state;

  /* extract wrap request from windowBits parameter */
  if (windowBits < 0) {
    wrap = 0;
    windowBits = -windowBits;
  }
  else {
    wrap = (windowBits >> 4) + 1;
    if (windowBits < 48) {
      windowBits &= 15;
    }
  }

  /* set number of window bits, free window if different */
  if (windowBits && (windowBits < 8 || windowBits > 15)) {
    return Z_STREAM_ERROR;
  }
  if (state.window !== null && state.wbits !== windowBits) {
    state.window = null;
  }

  /* update state and reset the rest of it */
  state.wrap = wrap;
  state.wbits = windowBits;
  return inflateReset(strm);
};


const inflateInit2 = (strm, windowBits) => {

  if (!strm) { return Z_STREAM_ERROR; }
  //strm.msg = Z_NULL;                 /* in case we return an error */

  const state = new InflateState();

  //if (state === Z_NULL) return Z_MEM_ERROR;
  //Tracev((stderr, "inflate: allocated\n"));
  strm.state = state;
  state.window = null/*Z_NULL*/;
  const ret = inflateReset2(strm, windowBits);
  if (ret !== Z_OK) {
    strm.state = null/*Z_NULL*/;
  }
  return ret;
};


const inflateInit = (strm) => {

  return inflateInit2(strm, DEF_WBITS);
};


/*
 Return state with length and distance decoding tables and index sizes set to
 fixed code decoding.  Normally this returns fixed tables from inffixed.h.
 If BUILDFIXED is defined, then instead this routine builds the tables the
 first time it's called, and returns those tables the first time and
 thereafter.  This reduces the size of the code by about 2K bytes, in
 exchange for a little execution time.  However, BUILDFIXED should not be
 used for threaded applications, since the rewriting of the tables and virgin
 may not be thread-safe.
 */
let virgin = true;

let lenfix, distfix; // We have no pointers in JS, so keep tables separate


const fixedtables = (state) => {

  /* build fixed huffman tables if first call (may not be thread safe) */
  if (virgin) {
    lenfix = new Int32Array(512);
    distfix = new Int32Array(32);

    /* literal/length table */
    let sym = 0;
    while (sym < 144) { state.lens[sym++] = 8; }
    while (sym < 256) { state.lens[sym++] = 9; }
    while (sym < 280) { state.lens[sym++] = 7; }
    while (sym < 288) { state.lens[sym++] = 8; }

    inflate_table(LENS,  state.lens, 0, 288, lenfix,   0, state.work, { bits: 9 });

    /* distance table */
    sym = 0;
    while (sym < 32) { state.lens[sym++] = 5; }

    inflate_table(DISTS, state.lens, 0, 32,   distfix, 0, state.work, { bits: 5 });

    /* do this just once */
    virgin = false;
  }

  state.lencode = lenfix;
  state.lenbits = 9;
  state.distcode = distfix;
  state.distbits = 5;
};


/*
 Update the window with the last wsize (normally 32K) bytes written before
 returning.  If window does not exist yet, create it.  This is only called
 when a window is already in use, or when output has been written during this
 inflate call, but the end of the deflate stream has not been reached yet.
 It is also called to create a window for dictionary data when a dictionary
 is loaded.

 Providing output buffers larger than 32K to inflate() should provide a speed
 advantage, since only the last 32K of output is copied to the sliding window
 upon return from inflate(), and since all distances after the first 32K of
 output will fall in the output data, making match copies simpler and faster.
 The advantage may be dependent on the size of the processor's data caches.
 */
const updatewindow = (strm, src, end, copy) => {

  let dist;
  const state = strm.state;

  /* if it hasn't been done already, allocate space for the window */
  if (state.window === null) {
    state.wsize = 1 << state.wbits;
    state.wnext = 0;
    state.whave = 0;

    state.window = new Uint8Array(state.wsize);
  }

  /* copy state->wsize or less output bytes into the circular window */
  if (copy >= state.wsize) {
    state.window.set(src.subarray(end - state.wsize, end), 0);
    state.wnext = 0;
    state.whave = state.wsize;
  }
  else {
    dist = state.wsize - state.wnext;
    if (dist > copy) {
      dist = copy;
    }
    //zmemcpy(state->window + state->wnext, end - copy, dist);
    state.window.set(src.subarray(end - copy, end - copy + dist), state.wnext);
    copy -= dist;
    if (copy) {
      //zmemcpy(state->window, end - copy, copy);
      state.window.set(src.subarray(end - copy, end), 0);
      state.wnext = copy;
      state.whave = state.wsize;
    }
    else {
      state.wnext += dist;
      if (state.wnext === state.wsize) { state.wnext = 0; }
      if (state.whave < state.wsize) { state.whave += dist; }
    }
  }
  return 0;
};


const inflate = (strm, flush) => {

  let state;
  let input, output;          // input/output buffers
  let next;                   /* next input INDEX */
  let put;                    /* next output INDEX */
  let have, left;             /* available input and output */
  let hold;                   /* bit buffer */
  let bits;                   /* bits in bit buffer */
  let _in, _out;              /* save starting available input and output */
  let copy;                   /* number of stored or match bytes to copy */
  let from;                   /* where to copy match bytes from */
  let from_source;
  let here = 0;               /* current decoding table entry */
  let here_bits, here_op, here_val; // paked "here" denormalized (JS specific)
  //let last;                   /* parent table entry */
  let last_bits, last_op, last_val; // paked "last" denormalized (JS specific)
  let len;                    /* length to copy for repeats, bits to drop */
  let ret;                    /* return code */
  const hbuf = new Uint8Array(4);    /* buffer for gzip header crc calculation */
  let opts;

  let n; // temporary variable for NEED_BITS

  const order = /* permutation of code lengths */
    new Uint8Array([ 16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15 ]);


  if (!strm || !strm.state || !strm.output ||
      (!strm.input && strm.avail_in !== 0)) {
    return Z_STREAM_ERROR;
  }

  state = strm.state;
  if (state.mode === TYPE) { state.mode = TYPEDO; }    /* skip check */


  //--- LOAD() ---
  put = strm.next_out;
  output = strm.output;
  left = strm.avail_out;
  next = strm.next_in;
  input = strm.input;
  have = strm.avail_in;
  hold = state.hold;
  bits = state.bits;
  //---

  _in = have;
  _out = left;
  ret = Z_OK;

  inf_leave: // goto emulation
  for (;;) {
    switch (state.mode) {
      case HEAD:
        if (state.wrap === 0) {
          state.mode = TYPEDO;
          break;
        }
        //=== NEEDBITS(16);
        while (bits < 16) {
          if (have === 0) { break inf_leave; }
          have--;
          hold += input[next++] << bits;
          bits += 8;
        }
        //===//
        if ((state.wrap & 2) && hold === 0x8b1f) {  /* gzip header */
          state.check = 0/*crc32(0L, Z_NULL, 0)*/;
          //=== CRC2(state.check, hold);
          hbuf[0] = hold & 0xff;
          hbuf[1] = (hold >>> 8) & 0xff;
          state.check = crc32(state.check, hbuf, 2, 0);
          //===//

          //=== INITBITS();
          hold = 0;
          bits = 0;
          //===//
          state.mode = FLAGS;
          break;
        }
        state.flags = 0;           /* expect zlib header */
        if (state.head) {
          state.head.done = false;
        }
        if (!(state.wrap & 1) ||   /* check if zlib header allowed */
          (((hold & 0xff)/*BITS(8)*/ << 8) + (hold >> 8)) % 31) {
          strm.msg = 'incorrect header check';
          state.mode = BAD;
          break;
        }
        if ((hold & 0x0f)/*BITS(4)*/ !== Z_DEFLATED) {
          strm.msg = 'unknown compression method';
          state.mode = BAD;
          break;
        }
        //--- DROPBITS(4) ---//
        hold >>>= 4;
        bits -= 4;
        //---//
        len = (hold & 0x0f)/*BITS(4)*/ + 8;
        if (state.wbits === 0) {
          state.wbits = len;
        }
        else if (len > state.wbits) {
          strm.msg = 'invalid window size';
          state.mode = BAD;
          break;
        }

        // !!! pako patch. Force use `options.windowBits` if passed.
        // Required to always use max window size by default.
        state.dmax = 1 << state.wbits;
        //state.dmax = 1 << len;

        //Tracev((stderr, "inflate:   zlib header ok\n"));
        strm.adler = state.check = 1/*adler32(0L, Z_NULL, 0)*/;
        state.mode = hold & 0x200 ? DICTID : TYPE;
        //=== INITBITS();
        hold = 0;
        bits = 0;
        //===//
        break;
      case FLAGS:
        //=== NEEDBITS(16); */
        while (bits < 16) {
          if (have === 0) { break inf_leave; }
          have--;
          hold += input[next++] << bits;
          bits += 8;
        }
        //===//
        state.flags = hold;
        if ((state.flags & 0xff) !== Z_DEFLATED) {
          strm.msg = 'unknown compression method';
          state.mode = BAD;
          break;
        }
        if (state.flags & 0xe000) {
          strm.msg = 'unknown header flags set';
          state.mode = BAD;
          break;
        }
        if (state.head) {
          state.head.text = ((hold >> 8) & 1);
        }
        if (state.flags & 0x0200) {
          //=== CRC2(state.check, hold);
          hbuf[0] = hold & 0xff;
          hbuf[1] = (hold >>> 8) & 0xff;
          state.check = crc32(state.check, hbuf, 2, 0);
          //===//
        }
        //=== INITBITS();
        hold = 0;
        bits = 0;
        //===//
        state.mode = TIME;
        /* falls through */
      case TIME:
        //=== NEEDBITS(32); */
        while (bits < 32) {
          if (have === 0) { break inf_leave; }
          have--;
          hold += input[next++] << bits;
          bits += 8;
        }
        //===//
        if (state.head) {
          state.head.time = hold;
        }
        if (state.flags & 0x0200) {
          //=== CRC4(state.check, hold)
          hbuf[0] = hold & 0xff;
          hbuf[1] = (hold >>> 8) & 0xff;
          hbuf[2] = (hold >>> 16) & 0xff;
          hbuf[3] = (hold >>> 24) & 0xff;
          state.check = crc32(state.check, hbuf, 4, 0);
          //===
        }
        //=== INITBITS();
        hold = 0;
        bits = 0;
        //===//
        state.mode = OS;
        /* falls through */
      case OS:
        //=== NEEDBITS(16); */
        while (bits < 16) {
          if (have === 0) { break inf_leave; }
          have--;
          hold += input[next++] << bits;
          bits += 8;
        }
        //===//
        if (state.head) {
          state.head.xflags = (hold & 0xff);
          state.head.os = (hold >> 8);
        }
        if (state.flags & 0x0200) {
          //=== CRC2(state.check, hold);
          hbuf[0] = hold & 0xff;
          hbuf[1] = (hold >>> 8) & 0xff;
          state.check = crc32(state.check, hbuf, 2, 0);
          //===//
        }
        //=== INITBITS();
        hold = 0;
        bits = 0;
        //===//
        state.mode = EXLEN;
        /* falls through */
      case EXLEN:
        if (state.flags & 0x0400) {
          //=== NEEDBITS(16); */
          while (bits < 16) {
            if (have === 0) { break inf_leave; }
            have--;
            hold += input[next++] << bits;
            bits += 8;
          }
          //===//
          state.length = hold;
          if (state.head) {
            state.head.extra_len = hold;
          }
          if (state.flags & 0x0200) {
            //=== CRC2(state.check, hold);
            hbuf[0] = hold & 0xff;
            hbuf[1] = (hold >>> 8) & 0xff;
            state.check = crc32(state.check, hbuf, 2, 0);
            //===//
          }
          //=== INITBITS();
          hold = 0;
          bits = 0;
          //===//
        }
        else if (state.head) {
          state.head.extra = null/*Z_NULL*/;
        }
        state.mode = EXTRA;
        /* falls through */
      case EXTRA:
        if (state.flags & 0x0400) {
          copy = state.length;
          if (copy > have) { copy = have; }
          if (copy) {
            if (state.head) {
              len = state.head.extra_len - state.length;
              if (!state.head.extra) {
                // Use untyped array for more convenient processing later
                state.head.extra = new Uint8Array(state.head.extra_len);
              }
              state.head.extra.set(
                input.subarray(
                  next,
                  // extra field is limited to 65536 bytes
                  // - no need for additional size check
                  next + copy
                ),
                /*len + copy > state.head.extra_max - len ? state.head.extra_max : copy,*/
                len
              );
              //zmemcpy(state.head.extra + len, next,
              //        len + copy > state.head.extra_max ?
              //        state.head.extra_max - len : copy);
            }
            if (state.flags & 0x0200) {
              state.check = crc32(state.check, input, copy, next);
            }
            have -= copy;
            next += copy;
            state.length -= copy;
          }
          if (state.length) { break inf_leave; }
        }
        state.length = 0;
        state.mode = NAME;
        /* falls through */
      case NAME:
        if (state.flags & 0x0800) {
          if (have === 0) { break inf_leave; }
          copy = 0;
          do {
            // TODO: 2 or 1 bytes?
            len = input[next + copy++];
            /* use constant limit because in js we should not preallocate memory */
            if (state.head && len &&
                (state.length < 65536 /*state.head.name_max*/)) {
              state.head.name += String.fromCharCode(len);
            }
          } while (len && copy < have);

          if (state.flags & 0x0200) {
            state.check = crc32(state.check, input, copy, next);
          }
          have -= copy;
          next += copy;
          if (len) { break inf_leave; }
        }
        else if (state.head) {
          state.head.name = null;
        }
        state.length = 0;
        state.mode = COMMENT;
        /* falls through */
      case COMMENT:
        if (state.flags & 0x1000) {
          if (have === 0) { break inf_leave; }
          copy = 0;
          do {
            len = input[next + copy++];
            /* use constant limit because in js we should not preallocate memory */
            if (state.head && len &&
                (state.length < 65536 /*state.head.comm_max*/)) {
              state.head.comment += String.fromCharCode(len);
            }
          } while (len && copy < have);
          if (state.flags & 0x0200) {
            state.check = crc32(state.check, input, copy, next);
          }
          have -= copy;
          next += copy;
          if (len) { break inf_leave; }
        }
        else if (state.head) {
          state.head.comment = null;
        }
        state.mode = HCRC;
        /* falls through */
      case HCRC:
        if (state.flags & 0x0200) {
          //=== NEEDBITS(16); */
          while (bits < 16) {
            if (have === 0) { break inf_leave; }
            have--;
            hold += input[next++] << bits;
            bits += 8;
          }
          //===//
          if (hold !== (state.check & 0xffff)) {
            strm.msg = 'header crc mismatch';
            state.mode = BAD;
            break;
          }
          //=== INITBITS();
          hold = 0;
          bits = 0;
          //===//
        }
        if (state.head) {
          state.head.hcrc = ((state.flags >> 9) & 1);
          state.head.done = true;
        }
        strm.adler = state.check = 0;
        state.mode = TYPE;
        break;
      case DICTID:
        //=== NEEDBITS(32); */
        while (bits < 32) {
          if (have === 0) { break inf_leave; }
          have--;
          hold += input[next++] << bits;
          bits += 8;
        }
        //===//
        strm.adler = state.check = zswap32(hold);
        //=== INITBITS();
        hold = 0;
        bits = 0;
        //===//
        state.mode = DICT;
        /* falls through */
      case DICT:
        if (state.havedict === 0) {
          //--- RESTORE() ---
          strm.next_out = put;
          strm.avail_out = left;
          strm.next_in = next;
          strm.avail_in = have;
          state.hold = hold;
          state.bits = bits;
          //---
          return Z_NEED_DICT;
        }
        strm.adler = state.check = 1/*adler32(0L, Z_NULL, 0)*/;
        state.mode = TYPE;
        /* falls through */
      case TYPE:
        if (flush === Z_BLOCK || flush === Z_TREES) { break inf_leave; }
        /* falls through */
      case TYPEDO:
        if (state.last) {
          //--- BYTEBITS() ---//
          hold >>>= bits & 7;
          bits -= bits & 7;
          //---//
          state.mode = CHECK;
          break;
        }
        //=== NEEDBITS(3); */
        while (bits < 3) {
          if (have === 0) { break inf_leave; }
          have--;
          hold += input[next++] << bits;
          bits += 8;
        }
        //===//
        state.last = (hold & 0x01)/*BITS(1)*/;
        //--- DROPBITS(1) ---//
        hold >>>= 1;
        bits -= 1;
        //---//

        switch ((hold & 0x03)/*BITS(2)*/) {
          case 0:                             /* stored block */
            //Tracev((stderr, "inflate:     stored block%s\n",
            //        state.last ? " (last)" : ""));
            state.mode = STORED;
            break;
          case 1:                             /* fixed block */
            fixedtables(state);
            //Tracev((stderr, "inflate:     fixed codes block%s\n",
            //        state.last ? " (last)" : ""));
            state.mode = LEN_;             /* decode codes */
            if (flush === Z_TREES) {
              //--- DROPBITS(2) ---//
              hold >>>= 2;
              bits -= 2;
              //---//
              break inf_leave;
            }
            break;
          case 2:                             /* dynamic block */
            //Tracev((stderr, "inflate:     dynamic codes block%s\n",
            //        state.last ? " (last)" : ""));
            state.mode = TABLE;
            break;
          case 3:
            strm.msg = 'invalid block type';
            state.mode = BAD;
        }
        //--- DROPBITS(2) ---//
        hold >>>= 2;
        bits -= 2;
        //---//
        break;
      case STORED:
        //--- BYTEBITS() ---// /* go to byte boundary */
        hold >>>= bits & 7;
        bits -= bits & 7;
        //---//
        //=== NEEDBITS(32); */
        while (bits < 32) {
          if (have === 0) { break inf_leave; }
          have--;
          hold += input[next++] << bits;
          bits += 8;
        }
        //===//
        if ((hold & 0xffff) !== ((hold >>> 16) ^ 0xffff)) {
          strm.msg = 'invalid stored block lengths';
          state.mode = BAD;
          break;
        }
        state.length = hold & 0xffff;
        //Tracev((stderr, "inflate:       stored length %u\n",
        //        state.length));
        //=== INITBITS();
        hold = 0;
        bits = 0;
        //===//
        state.mode = COPY_;
        if (flush === Z_TREES) { break inf_leave; }
        /* falls through */
      case COPY_:
        state.mode = COPY;
        /* falls through */
      case COPY:
        copy = state.length;
        if (copy) {
          if (copy > have) { copy = have; }
          if (copy > left) { copy = left; }
          if (copy === 0) { break inf_leave; }
          //--- zmemcpy(put, next, copy); ---
          output.set(input.subarray(next, next + copy), put);
          //---//
          have -= copy;
          next += copy;
          left -= copy;
          put += copy;
          state.length -= copy;
          break;
        }
        //Tracev((stderr, "inflate:       stored end\n"));
        state.mode = TYPE;
        break;
      case TABLE:
        //=== NEEDBITS(14); */
        while (bits < 14) {
          if (have === 0) { break inf_leave; }
          have--;
          hold += input[next++] << bits;
          bits += 8;
        }
        //===//
        state.nlen = (hold & 0x1f)/*BITS(5)*/ + 257;
        //--- DROPBITS(5) ---//
        hold >>>= 5;
        bits -= 5;
        //---//
        state.ndist = (hold & 0x1f)/*BITS(5)*/ + 1;
        //--- DROPBITS(5) ---//
        hold >>>= 5;
        bits -= 5;
        //---//
        state.ncode = (hold & 0x0f)/*BITS(4)*/ + 4;
        //--- DROPBITS(4) ---//
        hold >>>= 4;
        bits -= 4;
        //---//
//#ifndef PKZIP_BUG_WORKAROUND
        if (state.nlen > 286 || state.ndist > 30) {
          strm.msg = 'too many length or distance symbols';
          state.mode = BAD;
          break;
        }
//#endif
        //Tracev((stderr, "inflate:       table sizes ok\n"));
        state.have = 0;
        state.mode = LENLENS;
        /* falls through */
      case LENLENS:
        while (state.have < state.ncode) {
          //=== NEEDBITS(3);
          while (bits < 3) {
            if (have === 0) { break inf_leave; }
            have--;
            hold += input[next++] << bits;
            bits += 8;
          }
          //===//
          state.lens[order[state.have++]] = (hold & 0x07);//BITS(3);
          //--- DROPBITS(3) ---//
          hold >>>= 3;
          bits -= 3;
          //---//
        }
        while (state.have < 19) {
          state.lens[order[state.have++]] = 0;
        }
        // We have separate tables & no pointers. 2 commented lines below not needed.
        //state.next = state.codes;
        //state.lencode = state.next;
        // Switch to use dynamic table
        state.lencode = state.lendyn;
        state.lenbits = 7;

        opts = { bits: state.lenbits };
        ret = inflate_table(CODES, state.lens, 0, 19, state.lencode, 0, state.work, opts);
        state.lenbits = opts.bits;

        if (ret) {
          strm.msg = 'invalid code lengths set';
          state.mode = BAD;
          break;
        }
        //Tracev((stderr, "inflate:       code lengths ok\n"));
        state.have = 0;
        state.mode = CODELENS;
        /* falls through */
      case CODELENS:
        while (state.have < state.nlen + state.ndist) {
          for (;;) {
            here = state.lencode[hold & ((1 << state.lenbits) - 1)];/*BITS(state.lenbits)*/
            here_bits = here >>> 24;
            here_op = (here >>> 16) & 0xff;
            here_val = here & 0xffff;

            if ((here_bits) <= bits) { break; }
            //--- PULLBYTE() ---//
            if (have === 0) { break inf_leave; }
            have--;
            hold += input[next++] << bits;
            bits += 8;
            //---//
          }
          if (here_val < 16) {
            //--- DROPBITS(here.bits) ---//
            hold >>>= here_bits;
            bits -= here_bits;
            //---//
            state.lens[state.have++] = here_val;
          }
          else {
            if (here_val === 16) {
              //=== NEEDBITS(here.bits + 2);
              n = here_bits + 2;
              while (bits < n) {
                if (have === 0) { break inf_leave; }
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              //===//
              //--- DROPBITS(here.bits) ---//
              hold >>>= here_bits;
              bits -= here_bits;
              //---//
              if (state.have === 0) {
                strm.msg = 'invalid bit length repeat';
                state.mode = BAD;
                break;
              }
              len = state.lens[state.have - 1];
              copy = 3 + (hold & 0x03);//BITS(2);
              //--- DROPBITS(2) ---//
              hold >>>= 2;
              bits -= 2;
              //---//
            }
            else if (here_val === 17) {
              //=== NEEDBITS(here.bits + 3);
              n = here_bits + 3;
              while (bits < n) {
                if (have === 0) { break inf_leave; }
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              //===//
              //--- DROPBITS(here.bits) ---//
              hold >>>= here_bits;
              bits -= here_bits;
              //---//
              len = 0;
              copy = 3 + (hold & 0x07);//BITS(3);
              //--- DROPBITS(3) ---//
              hold >>>= 3;
              bits -= 3;
              //---//
            }
            else {
              //=== NEEDBITS(here.bits + 7);
              n = here_bits + 7;
              while (bits < n) {
                if (have === 0) { break inf_leave; }
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              //===//
              //--- DROPBITS(here.bits) ---//
              hold >>>= here_bits;
              bits -= here_bits;
              //---//
              len = 0;
              copy = 11 + (hold & 0x7f);//BITS(7);
              //--- DROPBITS(7) ---//
              hold >>>= 7;
              bits -= 7;
              //---//
            }
            if (state.have + copy > state.nlen + state.ndist) {
              strm.msg = 'invalid bit length repeat';
              state.mode = BAD;
              break;
            }
            while (copy--) {
              state.lens[state.have++] = len;
            }
          }
        }

        /* handle error breaks in while */
        if (state.mode === BAD) { break; }

        /* check for end-of-block code (better have one) */
        if (state.lens[256] === 0) {
          strm.msg = 'invalid code -- missing end-of-block';
          state.mode = BAD;
          break;
        }

        /* build code tables -- note: do not change the lenbits or distbits
           values here (9 and 6) without reading the comments in inftrees.h
           concerning the ENOUGH constants, which depend on those values */
        state.lenbits = 9;

        opts = { bits: state.lenbits };
        ret = inflate_table(LENS, state.lens, 0, state.nlen, state.lencode, 0, state.work, opts);
        // We have separate tables & no pointers. 2 commented lines below not needed.
        // state.next_index = opts.table_index;
        state.lenbits = opts.bits;
        // state.lencode = state.next;

        if (ret) {
          strm.msg = 'invalid literal/lengths set';
          state.mode = BAD;
          break;
        }

        state.distbits = 6;
        //state.distcode.copy(state.codes);
        // Switch to use dynamic table
        state.distcode = state.distdyn;
        opts = { bits: state.distbits };
        ret = inflate_table(DISTS, state.lens, state.nlen, state.ndist, state.distcode, 0, state.work, opts);
        // We have separate tables & no pointers. 2 commented lines below not needed.
        // state.next_index = opts.table_index;
        state.distbits = opts.bits;
        // state.distcode = state.next;

        if (ret) {
          strm.msg = 'invalid distances set';
          state.mode = BAD;
          break;
        }
        //Tracev((stderr, 'inflate:       codes ok\n'));
        state.mode = LEN_;
        if (flush === Z_TREES) { break inf_leave; }
        /* falls through */
      case LEN_:
        state.mode = LEN;
        /* falls through */
      case LEN:
        if (have >= 6 && left >= 258) {
          //--- RESTORE() ---
          strm.next_out = put;
          strm.avail_out = left;
          strm.next_in = next;
          strm.avail_in = have;
          state.hold = hold;
          state.bits = bits;
          //---
          inflate_fast(strm, _out);
          //--- LOAD() ---
          put = strm.next_out;
          output = strm.output;
          left = strm.avail_out;
          next = strm.next_in;
          input = strm.input;
          have = strm.avail_in;
          hold = state.hold;
          bits = state.bits;
          //---

          if (state.mode === TYPE) {
            state.back = -1;
          }
          break;
        }
        state.back = 0;
        for (;;) {
          here = state.lencode[hold & ((1 << state.lenbits) - 1)];  /*BITS(state.lenbits)*/
          here_bits = here >>> 24;
          here_op = (here >>> 16) & 0xff;
          here_val = here & 0xffff;

          if (here_bits <= bits) { break; }
          //--- PULLBYTE() ---//
          if (have === 0) { break inf_leave; }
          have--;
          hold += input[next++] << bits;
          bits += 8;
          //---//
        }
        if (here_op && (here_op & 0xf0) === 0) {
          last_bits = here_bits;
          last_op = here_op;
          last_val = here_val;
          for (;;) {
            here = state.lencode[last_val +
                    ((hold & ((1 << (last_bits + last_op)) - 1))/*BITS(last.bits + last.op)*/ >> last_bits)];
            here_bits = here >>> 24;
            here_op = (here >>> 16) & 0xff;
            here_val = here & 0xffff;

            if ((last_bits + here_bits) <= bits) { break; }
            //--- PULLBYTE() ---//
            if (have === 0) { break inf_leave; }
            have--;
            hold += input[next++] << bits;
            bits += 8;
            //---//
          }
          //--- DROPBITS(last.bits) ---//
          hold >>>= last_bits;
          bits -= last_bits;
          //---//
          state.back += last_bits;
        }
        //--- DROPBITS(here.bits) ---//
        hold >>>= here_bits;
        bits -= here_bits;
        //---//
        state.back += here_bits;
        state.length = here_val;
        if (here_op === 0) {
          //Tracevv((stderr, here.val >= 0x20 && here.val < 0x7f ?
          //        "inflate:         literal '%c'\n" :
          //        "inflate:         literal 0x%02x\n", here.val));
          state.mode = LIT;
          break;
        }
        if (here_op & 32) {
          //Tracevv((stderr, "inflate:         end of block\n"));
          state.back = -1;
          state.mode = TYPE;
          break;
        }
        if (here_op & 64) {
          strm.msg = 'invalid literal/length code';
          state.mode = BAD;
          break;
        }
        state.extra = here_op & 15;
        state.mode = LENEXT;
        /* falls through */
      case LENEXT:
        if (state.extra) {
          //=== NEEDBITS(state.extra);
          n = state.extra;
          while (bits < n) {
            if (have === 0) { break inf_leave; }
            have--;
            hold += input[next++] << bits;
            bits += 8;
          }
          //===//
          state.length += hold & ((1 << state.extra) - 1)/*BITS(state.extra)*/;
          //--- DROPBITS(state.extra) ---//
          hold >>>= state.extra;
          bits -= state.extra;
          //---//
          state.back += state.extra;
        }
        //Tracevv((stderr, "inflate:         length %u\n", state.length));
        state.was = state.length;
        state.mode = DIST;
        /* falls through */
      case DIST:
        for (;;) {
          here = state.distcode[hold & ((1 << state.distbits) - 1)];/*BITS(state.distbits)*/
          here_bits = here >>> 24;
          here_op = (here >>> 16) & 0xff;
          here_val = here & 0xffff;

          if ((here_bits) <= bits) { break; }
          //--- PULLBYTE() ---//
          if (have === 0) { break inf_leave; }
          have--;
          hold += input[next++] << bits;
          bits += 8;
          //---//
        }
        if ((here_op & 0xf0) === 0) {
          last_bits = here_bits;
          last_op = here_op;
          last_val = here_val;
          for (;;) {
            here = state.distcode[last_val +
                    ((hold & ((1 << (last_bits + last_op)) - 1))/*BITS(last.bits + last.op)*/ >> last_bits)];
            here_bits = here >>> 24;
            here_op = (here >>> 16) & 0xff;
            here_val = here & 0xffff;

            if ((last_bits + here_bits) <= bits) { break; }
            //--- PULLBYTE() ---//
            if (have === 0) { break inf_leave; }
            have--;
            hold += input[next++] << bits;
            bits += 8;
            //---//
          }
          //--- DROPBITS(last.bits) ---//
          hold >>>= last_bits;
          bits -= last_bits;
          //---//
          state.back += last_bits;
        }
        //--- DROPBITS(here.bits) ---//
        hold >>>= here_bits;
        bits -= here_bits;
        //---//
        state.back += here_bits;
        if (here_op & 64) {
          strm.msg = 'invalid distance code';
          state.mode = BAD;
          break;
        }
        state.offset = here_val;
        state.extra = (here_op) & 15;
        state.mode = DISTEXT;
        /* falls through */
      case DISTEXT:
        if (state.extra) {
          //=== NEEDBITS(state.extra);
          n = state.extra;
          while (bits < n) {
            if (have === 0) { break inf_leave; }
            have--;
            hold += input[next++] << bits;
            bits += 8;
          }
          //===//
          state.offset += hold & ((1 << state.extra) - 1)/*BITS(state.extra)*/;
          //--- DROPBITS(state.extra) ---//
          hold >>>= state.extra;
          bits -= state.extra;
          //---//
          state.back += state.extra;
        }
//#ifdef INFLATE_STRICT
        if (state.offset > state.dmax) {
          strm.msg = 'invalid distance too far back';
          state.mode = BAD;
          break;
        }
//#endif
        //Tracevv((stderr, "inflate:         distance %u\n", state.offset));
        state.mode = MATCH;
        /* falls through */
      case MATCH:
        if (left === 0) { break inf_leave; }
        copy = _out - left;
        if (state.offset > copy) {         /* copy from window */
          copy = state.offset - copy;
          if (copy > state.whave) {
            if (state.sane) {
              strm.msg = 'invalid distance too far back';
              state.mode = BAD;
              break;
            }
// (!) This block is disabled in zlib defaults,
// don't enable it for binary compatibility
//#ifdef INFLATE_ALLOW_INVALID_DISTANCE_TOOFAR_ARRR
//          Trace((stderr, "inflate.c too far\n"));
//          copy -= state.whave;
//          if (copy > state.length) { copy = state.length; }
//          if (copy > left) { copy = left; }
//          left -= copy;
//          state.length -= copy;
//          do {
//            output[put++] = 0;
//          } while (--copy);
//          if (state.length === 0) { state.mode = LEN; }
//          break;
//#endif
          }
          if (copy > state.wnext) {
            copy -= state.wnext;
            from = state.wsize - copy;
          }
          else {
            from = state.wnext - copy;
          }
          if (copy > state.length) { copy = state.length; }
          from_source = state.window;
        }
        else {                              /* copy from output */
          from_source = output;
          from = put - state.offset;
          copy = state.length;
        }
        if (copy > left) { copy = left; }
        left -= copy;
        state.length -= copy;
        do {
          output[put++] = from_source[from++];
        } while (--copy);
        if (state.length === 0) { state.mode = LEN; }
        break;
      case LIT:
        if (left === 0) { break inf_leave; }
        output[put++] = state.length;
        left--;
        state.mode = LEN;
        break;
      case CHECK:
        if (state.wrap) {
          //=== NEEDBITS(32);
          while (bits < 32) {
            if (have === 0) { break inf_leave; }
            have--;
            // Use '|' instead of '+' to make sure that result is signed
            hold |= input[next++] << bits;
            bits += 8;
          }
          //===//
          _out -= left;
          strm.total_out += _out;
          state.total += _out;
          if (_out) {
            strm.adler = state.check =
                /*UPDATE(state.check, put - _out, _out);*/
                (state.flags ? crc32(state.check, output, _out, put - _out) : adler32(state.check, output, _out, put - _out));

          }
          _out = left;
          // NB: crc32 stored as signed 32-bit int, zswap32 returns signed too
          if ((state.flags ? hold : zswap32(hold)) !== state.check) {
            strm.msg = 'incorrect data check';
            state.mode = BAD;
            break;
          }
          //=== INITBITS();
          hold = 0;
          bits = 0;
          //===//
          //Tracev((stderr, "inflate:   check matches trailer\n"));
        }
        state.mode = LENGTH;
        /* falls through */
      case LENGTH:
        if (state.wrap && state.flags) {
          //=== NEEDBITS(32);
          while (bits < 32) {
            if (have === 0) { break inf_leave; }
            have--;
            hold += input[next++] << bits;
            bits += 8;
          }
          //===//
          if (hold !== (state.total & 0xffffffff)) {
            strm.msg = 'incorrect length check';
            state.mode = BAD;
            break;
          }
          //=== INITBITS();
          hold = 0;
          bits = 0;
          //===//
          //Tracev((stderr, "inflate:   length matches trailer\n"));
        }
        state.mode = DONE;
        /* falls through */
      case DONE:
        ret = Z_STREAM_END;
        break inf_leave;
      case BAD:
        ret = Z_DATA_ERROR;
        break inf_leave;
      case MEM:
        return Z_MEM_ERROR;
      case SYNC:
        /* falls through */
      default:
        return Z_STREAM_ERROR;
    }
  }

  // inf_leave <- here is real place for "goto inf_leave", emulated via "break inf_leave"

  /*
     Return from inflate(), updating the total counts and the check value.
     If there was no progress during the inflate() call, return a buffer
     error.  Call updatewindow() to create and/or update the window state.
     Note: a memory error from inflate() is non-recoverable.
   */

  //--- RESTORE() ---
  strm.next_out = put;
  strm.avail_out = left;
  strm.next_in = next;
  strm.avail_in = have;
  state.hold = hold;
  state.bits = bits;
  //---

  if (state.wsize || (_out !== strm.avail_out && state.mode < BAD &&
                      (state.mode < CHECK || flush !== Z_FINISH))) {
    if (updatewindow(strm, strm.output, strm.next_out, _out - strm.avail_out)) {
      state.mode = MEM;
      return Z_MEM_ERROR;
    }
  }
  _in -= strm.avail_in;
  _out -= strm.avail_out;
  strm.total_in += _in;
  strm.total_out += _out;
  state.total += _out;
  if (state.wrap && _out) {
    strm.adler = state.check = /*UPDATE(state.check, strm.next_out - _out, _out);*/
      (state.flags ? crc32(state.check, output, _out, strm.next_out - _out) : adler32(state.check, output, _out, strm.next_out - _out));
  }
  strm.data_type = state.bits + (state.last ? 64 : 0) +
                    (state.mode === TYPE ? 128 : 0) +
                    (state.mode === LEN_ || state.mode === COPY_ ? 256 : 0);
  if (((_in === 0 && _out === 0) || flush === Z_FINISH) && ret === Z_OK) {
    ret = Z_BUF_ERROR;
  }
  return ret;
};


const inflateEnd = (strm) => {

  if (!strm || !strm.state /*|| strm->zfree == (free_func)0*/) {
    return Z_STREAM_ERROR;
  }

  let state = strm.state;
  if (state.window) {
    state.window = null;
  }
  strm.state = null;
  return Z_OK;
};


const inflateGetHeader = (strm, head) => {

  /* check state */
  if (!strm || !strm.state) { return Z_STREAM_ERROR; }
  const state = strm.state;
  if ((state.wrap & 2) === 0) { return Z_STREAM_ERROR; }

  /* save header structure */
  state.head = head;
  head.done = false;
  return Z_OK;
};


const inflateSetDictionary = (strm, dictionary) => {
  const dictLength = dictionary.length;

  let state;
  let dictid;
  let ret;

  /* check state */
  if (!strm /* == Z_NULL */ || !strm.state /* == Z_NULL */) { return Z_STREAM_ERROR; }
  state = strm.state;

  if (state.wrap !== 0 && state.mode !== DICT) {
    return Z_STREAM_ERROR;
  }

  /* check for correct dictionary identifier */
  if (state.mode === DICT) {
    dictid = 1; /* adler32(0, null, 0)*/
    /* dictid = adler32(dictid, dictionary, dictLength); */
    dictid = adler32(dictid, dictionary, dictLength, 0);
    if (dictid !== state.check) {
      return Z_DATA_ERROR;
    }
  }
  /* copy dictionary to window using updatewindow(), which will amend the
   existing dictionary if appropriate */
  ret = updatewindow(strm, dictionary, dictLength, dictLength);
  if (ret) {
    state.mode = MEM;
    return Z_MEM_ERROR;
  }
  state.havedict = 1;
  // Tracev((stderr, "inflate:   dictionary set\n"));
  return Z_OK;
};


module.exports.inflateReset = inflateReset;
module.exports.inflateReset2 = inflateReset2;
module.exports.inflateResetKeep = inflateResetKeep;
module.exports.inflateInit = inflateInit;
module.exports.inflateInit2 = inflateInit2;
module.exports.inflate = inflate;
module.exports.inflateEnd = inflateEnd;
module.exports.inflateGetHeader = inflateGetHeader;
module.exports.inflateSetDictionary = inflateSetDictionary;
module.exports.inflateInfo = 'pako inflate (from Nodeca project)';

/* Not implemented
module.exports.inflateCopy = inflateCopy;
module.exports.inflateGetDictionary = inflateGetDictionary;
module.exports.inflateMark = inflateMark;
module.exports.inflatePrime = inflatePrime;
module.exports.inflateSync = inflateSync;
module.exports.inflateSyncPoint = inflateSyncPoint;
module.exports.inflateUndermine = inflateUndermine;
*/


/***/ }),

/***/ "./node_modules/pako/lib/zlib/inftrees.js":
/*!************************************************!*\
  !*** ./node_modules/pako/lib/zlib/inftrees.js ***!
  \************************************************/
/***/ (function(module) {

"use strict";


// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

const MAXBITS = 15;
const ENOUGH_LENS = 852;
const ENOUGH_DISTS = 592;
//const ENOUGH = (ENOUGH_LENS+ENOUGH_DISTS);

const CODES = 0;
const LENS = 1;
const DISTS = 2;

const lbase = new Uint16Array([ /* Length codes 257..285 base */
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
  35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258, 0, 0
]);

const lext = new Uint8Array([ /* Length codes 257..285 extra */
  16, 16, 16, 16, 16, 16, 16, 16, 17, 17, 17, 17, 18, 18, 18, 18,
  19, 19, 19, 19, 20, 20, 20, 20, 21, 21, 21, 21, 16, 72, 78
]);

const dbase = new Uint16Array([ /* Distance codes 0..29 base */
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
  257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
  8193, 12289, 16385, 24577, 0, 0
]);

const dext = new Uint8Array([ /* Distance codes 0..29 extra */
  16, 16, 16, 16, 17, 17, 18, 18, 19, 19, 20, 20, 21, 21, 22, 22,
  23, 23, 24, 24, 25, 25, 26, 26, 27, 27,
  28, 28, 29, 29, 64, 64
]);

const inflate_table = (type, lens, lens_index, codes, table, table_index, work, opts) =>
{
  const bits = opts.bits;
      //here = opts.here; /* table entry for duplication */

  let len = 0;               /* a code's length in bits */
  let sym = 0;               /* index of code symbols */
  let min = 0, max = 0;          /* minimum and maximum code lengths */
  let root = 0;              /* number of index bits for root table */
  let curr = 0;              /* number of index bits for current table */
  let drop = 0;              /* code bits to drop for sub-table */
  let left = 0;                   /* number of prefix codes available */
  let used = 0;              /* code entries in table used */
  let huff = 0;              /* Huffman code */
  let incr;              /* for incrementing code, index */
  let fill;              /* index for replicating entries */
  let low;               /* low bits for current root entry */
  let mask;              /* mask for low root bits */
  let next;             /* next available space in table */
  let base = null;     /* base value table to use */
  let base_index = 0;
//  let shoextra;    /* extra bits table to use */
  let end;                    /* use base and extra for symbol > end */
  const count = new Uint16Array(MAXBITS + 1); //[MAXBITS+1];    /* number of codes of each length */
  const offs = new Uint16Array(MAXBITS + 1); //[MAXBITS+1];     /* offsets in table for each length */
  let extra = null;
  let extra_index = 0;

  let here_bits, here_op, here_val;

  /*
   Process a set of code lengths to create a canonical Huffman code.  The
   code lengths are lens[0..codes-1].  Each length corresponds to the
   symbols 0..codes-1.  The Huffman code is generated by first sorting the
   symbols by length from short to long, and retaining the symbol order
   for codes with equal lengths.  Then the code starts with all zero bits
   for the first code of the shortest length, and the codes are integer
   increments for the same length, and zeros are appended as the length
   increases.  For the deflate format, these bits are stored backwards
   from their more natural integer increment ordering, and so when the
   decoding tables are built in the large loop below, the integer codes
   are incremented backwards.

   This routine assumes, but does not check, that all of the entries in
   lens[] are in the range 0..MAXBITS.  The caller must assure this.
   1..MAXBITS is interpreted as that code length.  zero means that that
   symbol does not occur in this code.

   The codes are sorted by computing a count of codes for each length,
   creating from that a table of starting indices for each length in the
   sorted table, and then entering the symbols in order in the sorted
   table.  The sorted table is work[], with that space being provided by
   the caller.

   The length counts are used for other purposes as well, i.e. finding
   the minimum and maximum length codes, determining if there are any
   codes at all, checking for a valid set of lengths, and looking ahead
   at length counts to determine sub-table sizes when building the
   decoding tables.
   */

  /* accumulate lengths for codes (assumes lens[] all in 0..MAXBITS) */
  for (len = 0; len <= MAXBITS; len++) {
    count[len] = 0;
  }
  for (sym = 0; sym < codes; sym++) {
    count[lens[lens_index + sym]]++;
  }

  /* bound code lengths, force root to be within code lengths */
  root = bits;
  for (max = MAXBITS; max >= 1; max--) {
    if (count[max] !== 0) { break; }
  }
  if (root > max) {
    root = max;
  }
  if (max === 0) {                     /* no symbols to code at all */
    //table.op[opts.table_index] = 64;  //here.op = (var char)64;    /* invalid code marker */
    //table.bits[opts.table_index] = 1;   //here.bits = (var char)1;
    //table.val[opts.table_index++] = 0;   //here.val = (var short)0;
    table[table_index++] = (1 << 24) | (64 << 16) | 0;


    //table.op[opts.table_index] = 64;
    //table.bits[opts.table_index] = 1;
    //table.val[opts.table_index++] = 0;
    table[table_index++] = (1 << 24) | (64 << 16) | 0;

    opts.bits = 1;
    return 0;     /* no symbols, but wait for decoding to report error */
  }
  for (min = 1; min < max; min++) {
    if (count[min] !== 0) { break; }
  }
  if (root < min) {
    root = min;
  }

  /* check for an over-subscribed or incomplete set of lengths */
  left = 1;
  for (len = 1; len <= MAXBITS; len++) {
    left <<= 1;
    left -= count[len];
    if (left < 0) {
      return -1;
    }        /* over-subscribed */
  }
  if (left > 0 && (type === CODES || max !== 1)) {
    return -1;                      /* incomplete set */
  }

  /* generate offsets into symbol table for each length for sorting */
  offs[1] = 0;
  for (len = 1; len < MAXBITS; len++) {
    offs[len + 1] = offs[len] + count[len];
  }

  /* sort symbols by length, by symbol order within each length */
  for (sym = 0; sym < codes; sym++) {
    if (lens[lens_index + sym] !== 0) {
      work[offs[lens[lens_index + sym]]++] = sym;
    }
  }

  /*
   Create and fill in decoding tables.  In this loop, the table being
   filled is at next and has curr index bits.  The code being used is huff
   with length len.  That code is converted to an index by dropping drop
   bits off of the bottom.  For codes where len is less than drop + curr,
   those top drop + curr - len bits are incremented through all values to
   fill the table with replicated entries.

   root is the number of index bits for the root table.  When len exceeds
   root, sub-tables are created pointed to by the root entry with an index
   of the low root bits of huff.  This is saved in low to check for when a
   new sub-table should be started.  drop is zero when the root table is
   being filled, and drop is root when sub-tables are being filled.

   When a new sub-table is needed, it is necessary to look ahead in the
   code lengths to determine what size sub-table is needed.  The length
   counts are used for this, and so count[] is decremented as codes are
   entered in the tables.

   used keeps track of how many table entries have been allocated from the
   provided *table space.  It is checked for LENS and DIST tables against
   the constants ENOUGH_LENS and ENOUGH_DISTS to guard against changes in
   the initial root table size constants.  See the comments in inftrees.h
   for more information.

   sym increments through all symbols, and the loop terminates when
   all codes of length max, i.e. all codes, have been processed.  This
   routine permits incomplete codes, so another loop after this one fills
   in the rest of the decoding tables with invalid code markers.
   */

  /* set up for code type */
  // poor man optimization - use if-else instead of switch,
  // to avoid deopts in old v8
  if (type === CODES) {
    base = extra = work;    /* dummy value--not used */
    end = 19;

  } else if (type === LENS) {
    base = lbase;
    base_index -= 257;
    extra = lext;
    extra_index -= 257;
    end = 256;

  } else {                    /* DISTS */
    base = dbase;
    extra = dext;
    end = -1;
  }

  /* initialize opts for loop */
  huff = 0;                   /* starting code */
  sym = 0;                    /* starting code symbol */
  len = min;                  /* starting code length */
  next = table_index;              /* current table to fill in */
  curr = root;                /* current table index bits */
  drop = 0;                   /* current bits to drop from code for index */
  low = -1;                   /* trigger new sub-table when len > root */
  used = 1 << root;          /* use root table entries */
  mask = used - 1;            /* mask for comparing low */

  /* check available table space */
  if ((type === LENS && used > ENOUGH_LENS) ||
    (type === DISTS && used > ENOUGH_DISTS)) {
    return 1;
  }

  /* process all codes and make table entries */
  for (;;) {
    /* create table entry */
    here_bits = len - drop;
    if (work[sym] < end) {
      here_op = 0;
      here_val = work[sym];
    }
    else if (work[sym] > end) {
      here_op = extra[extra_index + work[sym]];
      here_val = base[base_index + work[sym]];
    }
    else {
      here_op = 32 + 64;         /* end of block */
      here_val = 0;
    }

    /* replicate for those indices with low len bits equal to huff */
    incr = 1 << (len - drop);
    fill = 1 << curr;
    min = fill;                 /* save offset to next table */
    do {
      fill -= incr;
      table[next + (huff >> drop) + fill] = (here_bits << 24) | (here_op << 16) | here_val |0;
    } while (fill !== 0);

    /* backwards increment the len-bit code huff */
    incr = 1 << (len - 1);
    while (huff & incr) {
      incr >>= 1;
    }
    if (incr !== 0) {
      huff &= incr - 1;
      huff += incr;
    } else {
      huff = 0;
    }

    /* go to next symbol, update count, len */
    sym++;
    if (--count[len] === 0) {
      if (len === max) { break; }
      len = lens[lens_index + work[sym]];
    }

    /* create new sub-table if needed */
    if (len > root && (huff & mask) !== low) {
      /* if first time, transition to sub-tables */
      if (drop === 0) {
        drop = root;
      }

      /* increment past last table */
      next += min;            /* here min is 1 << curr */

      /* determine length of next table */
      curr = len - drop;
      left = 1 << curr;
      while (curr + drop < max) {
        left -= count[curr + drop];
        if (left <= 0) { break; }
        curr++;
        left <<= 1;
      }

      /* check for enough space */
      used += 1 << curr;
      if ((type === LENS && used > ENOUGH_LENS) ||
        (type === DISTS && used > ENOUGH_DISTS)) {
        return 1;
      }

      /* point entry in root table to sub-table */
      low = huff & mask;
      /*table.op[low] = curr;
      table.bits[low] = root;
      table.val[low] = next - opts.table_index;*/
      table[low] = (root << 24) | (curr << 16) | (next - table_index) |0;
    }
  }

  /* fill in remaining table entry if code is incomplete (guaranteed to have
   at most one remaining entry, since if the code is incomplete, the
   maximum code length that was allowed to get this far is one bit) */
  if (huff !== 0) {
    //table.op[next + huff] = 64;            /* invalid code marker */
    //table.bits[next + huff] = len - drop;
    //table.val[next + huff] = 0;
    table[next + huff] = ((len - drop) << 24) | (64 << 16) |0;
  }

  /* set return parameters */
  //opts.table_index += used;
  opts.bits = root;
  return 0;
};


module.exports = inflate_table;


/***/ }),

/***/ "./node_modules/pako/lib/zlib/messages.js":
/*!************************************************!*\
  !*** ./node_modules/pako/lib/zlib/messages.js ***!
  \************************************************/
/***/ (function(module) {

"use strict";


// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

module.exports = {
  2:      'need dictionary',     /* Z_NEED_DICT       2  */
  1:      'stream end',          /* Z_STREAM_END      1  */
  0:      '',                    /* Z_OK              0  */
  '-1':   'file error',          /* Z_ERRNO         (-1) */
  '-2':   'stream error',        /* Z_STREAM_ERROR  (-2) */
  '-3':   'data error',          /* Z_DATA_ERROR    (-3) */
  '-4':   'insufficient memory', /* Z_MEM_ERROR     (-4) */
  '-5':   'buffer error',        /* Z_BUF_ERROR     (-5) */
  '-6':   'incompatible version' /* Z_VERSION_ERROR (-6) */
};


/***/ }),

/***/ "./node_modules/pako/lib/zlib/trees.js":
/*!*********************************************!*\
  !*** ./node_modules/pako/lib/zlib/trees.js ***!
  \*********************************************/
/***/ (function(module) {

"use strict";


// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

/* eslint-disable space-unary-ops */

/* Public constants ==========================================================*/
/* ===========================================================================*/


//const Z_FILTERED          = 1;
//const Z_HUFFMAN_ONLY      = 2;
//const Z_RLE               = 3;
const Z_FIXED               = 4;
//const Z_DEFAULT_STRATEGY  = 0;

/* Possible values of the data_type field (though see inflate()) */
const Z_BINARY              = 0;
const Z_TEXT                = 1;
//const Z_ASCII             = 1; // = Z_TEXT
const Z_UNKNOWN             = 2;

/*============================================================================*/


function zero(buf) { let len = buf.length; while (--len >= 0) { buf[len] = 0; } }

// From zutil.h

const STORED_BLOCK = 0;
const STATIC_TREES = 1;
const DYN_TREES    = 2;
/* The three kinds of block type */

const MIN_MATCH    = 3;
const MAX_MATCH    = 258;
/* The minimum and maximum match lengths */

// From deflate.h
/* ===========================================================================
 * Internal compression state.
 */

const LENGTH_CODES  = 29;
/* number of length codes, not counting the special END_BLOCK code */

const LITERALS      = 256;
/* number of literal bytes 0..255 */

const L_CODES       = LITERALS + 1 + LENGTH_CODES;
/* number of Literal or Length codes, including the END_BLOCK code */

const D_CODES       = 30;
/* number of distance codes */

const BL_CODES      = 19;
/* number of codes used to transfer the bit lengths */

const HEAP_SIZE     = 2 * L_CODES + 1;
/* maximum heap size */

const MAX_BITS      = 15;
/* All codes must not exceed MAX_BITS bits */

const Buf_size      = 16;
/* size of bit buffer in bi_buf */


/* ===========================================================================
 * Constants
 */

const MAX_BL_BITS = 7;
/* Bit length codes must not exceed MAX_BL_BITS bits */

const END_BLOCK   = 256;
/* end of block literal code */

const REP_3_6     = 16;
/* repeat previous bit length 3-6 times (2 bits of repeat count) */

const REPZ_3_10   = 17;
/* repeat a zero length 3-10 times  (3 bits of repeat count) */

const REPZ_11_138 = 18;
/* repeat a zero length 11-138 times  (7 bits of repeat count) */

/* eslint-disable comma-spacing,array-bracket-spacing */
const extra_lbits =   /* extra bits for each length code */
  new Uint8Array([0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0]);

const extra_dbits =   /* extra bits for each distance code */
  new Uint8Array([0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13]);

const extra_blbits =  /* extra bits for each bit length code */
  new Uint8Array([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,3,7]);

const bl_order =
  new Uint8Array([16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]);
/* eslint-enable comma-spacing,array-bracket-spacing */

/* The lengths of the bit length codes are sent in order of decreasing
 * probability, to avoid transmitting the lengths for unused bit length codes.
 */

/* ===========================================================================
 * Local data. These are initialized only once.
 */

// We pre-fill arrays with 0 to avoid uninitialized gaps

const DIST_CODE_LEN = 512; /* see definition of array dist_code below */

// !!!! Use flat array instead of structure, Freq = i*2, Len = i*2+1
const static_ltree  = new Array((L_CODES + 2) * 2);
zero(static_ltree);
/* The static literal tree. Since the bit lengths are imposed, there is no
 * need for the L_CODES extra codes used during heap construction. However
 * The codes 286 and 287 are needed to build a canonical tree (see _tr_init
 * below).
 */

const static_dtree  = new Array(D_CODES * 2);
zero(static_dtree);
/* The static distance tree. (Actually a trivial tree since all codes use
 * 5 bits.)
 */

const _dist_code    = new Array(DIST_CODE_LEN);
zero(_dist_code);
/* Distance codes. The first 256 values correspond to the distances
 * 3 .. 258, the last 256 values correspond to the top 8 bits of
 * the 15 bit distances.
 */

const _length_code  = new Array(MAX_MATCH - MIN_MATCH + 1);
zero(_length_code);
/* length code for each normalized match length (0 == MIN_MATCH) */

const base_length   = new Array(LENGTH_CODES);
zero(base_length);
/* First normalized length for each code (0 = MIN_MATCH) */

const base_dist     = new Array(D_CODES);
zero(base_dist);
/* First normalized distance for each code (0 = distance of 1) */


function StaticTreeDesc(static_tree, extra_bits, extra_base, elems, max_length) {

  this.static_tree  = static_tree;  /* static tree or NULL */
  this.extra_bits   = extra_bits;   /* extra bits for each code or NULL */
  this.extra_base   = extra_base;   /* base index for extra_bits */
  this.elems        = elems;        /* max number of elements in the tree */
  this.max_length   = max_length;   /* max bit length for the codes */

  // show if `static_tree` has data or dummy - needed for monomorphic objects
  this.has_stree    = static_tree && static_tree.length;
}


let static_l_desc;
let static_d_desc;
let static_bl_desc;


function TreeDesc(dyn_tree, stat_desc) {
  this.dyn_tree = dyn_tree;     /* the dynamic tree */
  this.max_code = 0;            /* largest code with non zero frequency */
  this.stat_desc = stat_desc;   /* the corresponding static tree */
}



const d_code = (dist) => {

  return dist < 256 ? _dist_code[dist] : _dist_code[256 + (dist >>> 7)];
};


/* ===========================================================================
 * Output a short LSB first on the stream.
 * IN assertion: there is enough room in pendingBuf.
 */
const put_short = (s, w) => {
//    put_byte(s, (uch)((w) & 0xff));
//    put_byte(s, (uch)((ush)(w) >> 8));
  s.pending_buf[s.pending++] = (w) & 0xff;
  s.pending_buf[s.pending++] = (w >>> 8) & 0xff;
};


/* ===========================================================================
 * Send a value on a given number of bits.
 * IN assertion: length <= 16 and value fits in length bits.
 */
const send_bits = (s, value, length) => {

  if (s.bi_valid > (Buf_size - length)) {
    s.bi_buf |= (value << s.bi_valid) & 0xffff;
    put_short(s, s.bi_buf);
    s.bi_buf = value >> (Buf_size - s.bi_valid);
    s.bi_valid += length - Buf_size;
  } else {
    s.bi_buf |= (value << s.bi_valid) & 0xffff;
    s.bi_valid += length;
  }
};


const send_code = (s, c, tree) => {

  send_bits(s, tree[c * 2]/*.Code*/, tree[c * 2 + 1]/*.Len*/);
};


/* ===========================================================================
 * Reverse the first len bits of a code, using straightforward code (a faster
 * method would use a table)
 * IN assertion: 1 <= len <= 15
 */
const bi_reverse = (code, len) => {

  let res = 0;
  do {
    res |= code & 1;
    code >>>= 1;
    res <<= 1;
  } while (--len > 0);
  return res >>> 1;
};


/* ===========================================================================
 * Flush the bit buffer, keeping at most 7 bits in it.
 */
const bi_flush = (s) => {

  if (s.bi_valid === 16) {
    put_short(s, s.bi_buf);
    s.bi_buf = 0;
    s.bi_valid = 0;

  } else if (s.bi_valid >= 8) {
    s.pending_buf[s.pending++] = s.bi_buf & 0xff;
    s.bi_buf >>= 8;
    s.bi_valid -= 8;
  }
};


/* ===========================================================================
 * Compute the optimal bit lengths for a tree and update the total bit length
 * for the current block.
 * IN assertion: the fields freq and dad are set, heap[heap_max] and
 *    above are the tree nodes sorted by increasing frequency.
 * OUT assertions: the field len is set to the optimal bit length, the
 *     array bl_count contains the frequencies for each bit length.
 *     The length opt_len is updated; static_len is also updated if stree is
 *     not null.
 */
const gen_bitlen = (s, desc) =>
//    deflate_state *s;
//    tree_desc *desc;    /* the tree descriptor */
{
  const tree            = desc.dyn_tree;
  const max_code        = desc.max_code;
  const stree           = desc.stat_desc.static_tree;
  const has_stree       = desc.stat_desc.has_stree;
  const extra           = desc.stat_desc.extra_bits;
  const base            = desc.stat_desc.extra_base;
  const max_length      = desc.stat_desc.max_length;
  let h;              /* heap index */
  let n, m;           /* iterate over the tree elements */
  let bits;           /* bit length */
  let xbits;          /* extra bits */
  let f;              /* frequency */
  let overflow = 0;   /* number of elements with bit length too large */

  for (bits = 0; bits <= MAX_BITS; bits++) {
    s.bl_count[bits] = 0;
  }

  /* In a first pass, compute the optimal bit lengths (which may
   * overflow in the case of the bit length tree).
   */
  tree[s.heap[s.heap_max] * 2 + 1]/*.Len*/ = 0; /* root of the heap */

  for (h = s.heap_max + 1; h < HEAP_SIZE; h++) {
    n = s.heap[h];
    bits = tree[tree[n * 2 + 1]/*.Dad*/ * 2 + 1]/*.Len*/ + 1;
    if (bits > max_length) {
      bits = max_length;
      overflow++;
    }
    tree[n * 2 + 1]/*.Len*/ = bits;
    /* We overwrite tree[n].Dad which is no longer needed */

    if (n > max_code) { continue; } /* not a leaf node */

    s.bl_count[bits]++;
    xbits = 0;
    if (n >= base) {
      xbits = extra[n - base];
    }
    f = tree[n * 2]/*.Freq*/;
    s.opt_len += f * (bits + xbits);
    if (has_stree) {
      s.static_len += f * (stree[n * 2 + 1]/*.Len*/ + xbits);
    }
  }
  if (overflow === 0) { return; }

  // Trace((stderr,"\nbit length overflow\n"));
  /* This happens for example on obj2 and pic of the Calgary corpus */

  /* Find the first bit length which could increase: */
  do {
    bits = max_length - 1;
    while (s.bl_count[bits] === 0) { bits--; }
    s.bl_count[bits]--;      /* move one leaf down the tree */
    s.bl_count[bits + 1] += 2; /* move one overflow item as its brother */
    s.bl_count[max_length]--;
    /* The brother of the overflow item also moves one step up,
     * but this does not affect bl_count[max_length]
     */
    overflow -= 2;
  } while (overflow > 0);

  /* Now recompute all bit lengths, scanning in increasing frequency.
   * h is still equal to HEAP_SIZE. (It is simpler to reconstruct all
   * lengths instead of fixing only the wrong ones. This idea is taken
   * from 'ar' written by Haruhiko Okumura.)
   */
  for (bits = max_length; bits !== 0; bits--) {
    n = s.bl_count[bits];
    while (n !== 0) {
      m = s.heap[--h];
      if (m > max_code) { continue; }
      if (tree[m * 2 + 1]/*.Len*/ !== bits) {
        // Trace((stderr,"code %d bits %d->%d\n", m, tree[m].Len, bits));
        s.opt_len += (bits - tree[m * 2 + 1]/*.Len*/) * tree[m * 2]/*.Freq*/;
        tree[m * 2 + 1]/*.Len*/ = bits;
      }
      n--;
    }
  }
};


/* ===========================================================================
 * Generate the codes for a given tree and bit counts (which need not be
 * optimal).
 * IN assertion: the array bl_count contains the bit length statistics for
 * the given tree and the field len is set for all tree elements.
 * OUT assertion: the field code is set for all tree elements of non
 *     zero code length.
 */
const gen_codes = (tree, max_code, bl_count) =>
//    ct_data *tree;             /* the tree to decorate */
//    int max_code;              /* largest code with non zero frequency */
//    ushf *bl_count;            /* number of codes at each bit length */
{
  const next_code = new Array(MAX_BITS + 1); /* next code value for each bit length */
  let code = 0;              /* running code value */
  let bits;                  /* bit index */
  let n;                     /* code index */

  /* The distribution counts are first used to generate the code values
   * without bit reversal.
   */
  for (bits = 1; bits <= MAX_BITS; bits++) {
    next_code[bits] = code = (code + bl_count[bits - 1]) << 1;
  }
  /* Check that the bit counts in bl_count are consistent. The last code
   * must be all ones.
   */
  //Assert (code + bl_count[MAX_BITS]-1 == (1<<MAX_BITS)-1,
  //        "inconsistent bit counts");
  //Tracev((stderr,"\ngen_codes: max_code %d ", max_code));

  for (n = 0;  n <= max_code; n++) {
    let len = tree[n * 2 + 1]/*.Len*/;
    if (len === 0) { continue; }
    /* Now reverse the bits */
    tree[n * 2]/*.Code*/ = bi_reverse(next_code[len]++, len);

    //Tracecv(tree != static_ltree, (stderr,"\nn %3d %c l %2d c %4x (%x) ",
    //     n, (isgraph(n) ? n : ' '), len, tree[n].Code, next_code[len]-1));
  }
};


/* ===========================================================================
 * Initialize the various 'constant' tables.
 */
const tr_static_init = () => {

  let n;        /* iterates over tree elements */
  let bits;     /* bit counter */
  let length;   /* length value */
  let code;     /* code value */
  let dist;     /* distance index */
  const bl_count = new Array(MAX_BITS + 1);
  /* number of codes at each bit length for an optimal tree */

  // do check in _tr_init()
  //if (static_init_done) return;

  /* For some embedded targets, global variables are not initialized: */
/*#ifdef NO_INIT_GLOBAL_POINTERS
  static_l_desc.static_tree = static_ltree;
  static_l_desc.extra_bits = extra_lbits;
  static_d_desc.static_tree = static_dtree;
  static_d_desc.extra_bits = extra_dbits;
  static_bl_desc.extra_bits = extra_blbits;
#endif*/

  /* Initialize the mapping length (0..255) -> length code (0..28) */
  length = 0;
  for (code = 0; code < LENGTH_CODES - 1; code++) {
    base_length[code] = length;
    for (n = 0; n < (1 << extra_lbits[code]); n++) {
      _length_code[length++] = code;
    }
  }
  //Assert (length == 256, "tr_static_init: length != 256");
  /* Note that the length 255 (match length 258) can be represented
   * in two different ways: code 284 + 5 bits or code 285, so we
   * overwrite length_code[255] to use the best encoding:
   */
  _length_code[length - 1] = code;

  /* Initialize the mapping dist (0..32K) -> dist code (0..29) */
  dist = 0;
  for (code = 0; code < 16; code++) {
    base_dist[code] = dist;
    for (n = 0; n < (1 << extra_dbits[code]); n++) {
      _dist_code[dist++] = code;
    }
  }
  //Assert (dist == 256, "tr_static_init: dist != 256");
  dist >>= 7; /* from now on, all distances are divided by 128 */
  for (; code < D_CODES; code++) {
    base_dist[code] = dist << 7;
    for (n = 0; n < (1 << (extra_dbits[code] - 7)); n++) {
      _dist_code[256 + dist++] = code;
    }
  }
  //Assert (dist == 256, "tr_static_init: 256+dist != 512");

  /* Construct the codes of the static literal tree */
  for (bits = 0; bits <= MAX_BITS; bits++) {
    bl_count[bits] = 0;
  }

  n = 0;
  while (n <= 143) {
    static_ltree[n * 2 + 1]/*.Len*/ = 8;
    n++;
    bl_count[8]++;
  }
  while (n <= 255) {
    static_ltree[n * 2 + 1]/*.Len*/ = 9;
    n++;
    bl_count[9]++;
  }
  while (n <= 279) {
    static_ltree[n * 2 + 1]/*.Len*/ = 7;
    n++;
    bl_count[7]++;
  }
  while (n <= 287) {
    static_ltree[n * 2 + 1]/*.Len*/ = 8;
    n++;
    bl_count[8]++;
  }
  /* Codes 286 and 287 do not exist, but we must include them in the
   * tree construction to get a canonical Huffman tree (longest code
   * all ones)
   */
  gen_codes(static_ltree, L_CODES + 1, bl_count);

  /* The static distance tree is trivial: */
  for (n = 0; n < D_CODES; n++) {
    static_dtree[n * 2 + 1]/*.Len*/ = 5;
    static_dtree[n * 2]/*.Code*/ = bi_reverse(n, 5);
  }

  // Now data ready and we can init static trees
  static_l_desc = new StaticTreeDesc(static_ltree, extra_lbits, LITERALS + 1, L_CODES, MAX_BITS);
  static_d_desc = new StaticTreeDesc(static_dtree, extra_dbits, 0,          D_CODES, MAX_BITS);
  static_bl_desc = new StaticTreeDesc(new Array(0), extra_blbits, 0,         BL_CODES, MAX_BL_BITS);

  //static_init_done = true;
};


/* ===========================================================================
 * Initialize a new block.
 */
const init_block = (s) => {

  let n; /* iterates over tree elements */

  /* Initialize the trees. */
  for (n = 0; n < L_CODES;  n++) { s.dyn_ltree[n * 2]/*.Freq*/ = 0; }
  for (n = 0; n < D_CODES;  n++) { s.dyn_dtree[n * 2]/*.Freq*/ = 0; }
  for (n = 0; n < BL_CODES; n++) { s.bl_tree[n * 2]/*.Freq*/ = 0; }

  s.dyn_ltree[END_BLOCK * 2]/*.Freq*/ = 1;
  s.opt_len = s.static_len = 0;
  s.last_lit = s.matches = 0;
};


/* ===========================================================================
 * Flush the bit buffer and align the output on a byte boundary
 */
const bi_windup = (s) =>
{
  if (s.bi_valid > 8) {
    put_short(s, s.bi_buf);
  } else if (s.bi_valid > 0) {
    //put_byte(s, (Byte)s->bi_buf);
    s.pending_buf[s.pending++] = s.bi_buf;
  }
  s.bi_buf = 0;
  s.bi_valid = 0;
};

/* ===========================================================================
 * Copy a stored block, storing first the length and its
 * one's complement if requested.
 */
const copy_block = (s, buf, len, header) =>
//DeflateState *s;
//charf    *buf;    /* the input data */
//unsigned len;     /* its length */
//int      header;  /* true if block header must be written */
{
  bi_windup(s);        /* align on byte boundary */

  if (header) {
    put_short(s, len);
    put_short(s, ~len);
  }
//  while (len--) {
//    put_byte(s, *buf++);
//  }
  s.pending_buf.set(s.window.subarray(buf, buf + len), s.pending);
  s.pending += len;
};

/* ===========================================================================
 * Compares to subtrees, using the tree depth as tie breaker when
 * the subtrees have equal frequency. This minimizes the worst case length.
 */
const smaller = (tree, n, m, depth) => {

  const _n2 = n * 2;
  const _m2 = m * 2;
  return (tree[_n2]/*.Freq*/ < tree[_m2]/*.Freq*/ ||
         (tree[_n2]/*.Freq*/ === tree[_m2]/*.Freq*/ && depth[n] <= depth[m]));
};

/* ===========================================================================
 * Restore the heap property by moving down the tree starting at node k,
 * exchanging a node with the smallest of its two sons if necessary, stopping
 * when the heap property is re-established (each father smaller than its
 * two sons).
 */
const pqdownheap = (s, tree, k) =>
//    deflate_state *s;
//    ct_data *tree;  /* the tree to restore */
//    int k;               /* node to move down */
{
  const v = s.heap[k];
  let j = k << 1;  /* left son of k */
  while (j <= s.heap_len) {
    /* Set j to the smallest of the two sons: */
    if (j < s.heap_len &&
      smaller(tree, s.heap[j + 1], s.heap[j], s.depth)) {
      j++;
    }
    /* Exit if v is smaller than both sons */
    if (smaller(tree, v, s.heap[j], s.depth)) { break; }

    /* Exchange v with the smallest son */
    s.heap[k] = s.heap[j];
    k = j;

    /* And continue down the tree, setting j to the left son of k */
    j <<= 1;
  }
  s.heap[k] = v;
};


// inlined manually
// const SMALLEST = 1;

/* ===========================================================================
 * Send the block data compressed using the given Huffman trees
 */
const compress_block = (s, ltree, dtree) =>
//    deflate_state *s;
//    const ct_data *ltree; /* literal tree */
//    const ct_data *dtree; /* distance tree */
{
  let dist;           /* distance of matched string */
  let lc;             /* match length or unmatched char (if dist == 0) */
  let lx = 0;         /* running index in l_buf */
  let code;           /* the code to send */
  let extra;          /* number of extra bits to send */

  if (s.last_lit !== 0) {
    do {
      dist = (s.pending_buf[s.d_buf + lx * 2] << 8) | (s.pending_buf[s.d_buf + lx * 2 + 1]);
      lc = s.pending_buf[s.l_buf + lx];
      lx++;

      if (dist === 0) {
        send_code(s, lc, ltree); /* send a literal byte */
        //Tracecv(isgraph(lc), (stderr," '%c' ", lc));
      } else {
        /* Here, lc is the match length - MIN_MATCH */
        code = _length_code[lc];
        send_code(s, code + LITERALS + 1, ltree); /* send the length code */
        extra = extra_lbits[code];
        if (extra !== 0) {
          lc -= base_length[code];
          send_bits(s, lc, extra);       /* send the extra length bits */
        }
        dist--; /* dist is now the match distance - 1 */
        code = d_code(dist);
        //Assert (code < D_CODES, "bad d_code");

        send_code(s, code, dtree);       /* send the distance code */
        extra = extra_dbits[code];
        if (extra !== 0) {
          dist -= base_dist[code];
          send_bits(s, dist, extra);   /* send the extra distance bits */
        }
      } /* literal or match pair ? */

      /* Check that the overlay between pending_buf and d_buf+l_buf is ok: */
      //Assert((uInt)(s->pending) < s->lit_bufsize + 2*lx,
      //       "pendingBuf overflow");

    } while (lx < s.last_lit);
  }

  send_code(s, END_BLOCK, ltree);
};


/* ===========================================================================
 * Construct one Huffman tree and assigns the code bit strings and lengths.
 * Update the total bit length for the current block.
 * IN assertion: the field freq is set for all tree elements.
 * OUT assertions: the fields len and code are set to the optimal bit length
 *     and corresponding code. The length opt_len is updated; static_len is
 *     also updated if stree is not null. The field max_code is set.
 */
const build_tree = (s, desc) =>
//    deflate_state *s;
//    tree_desc *desc; /* the tree descriptor */
{
  const tree     = desc.dyn_tree;
  const stree    = desc.stat_desc.static_tree;
  const has_stree = desc.stat_desc.has_stree;
  const elems    = desc.stat_desc.elems;
  let n, m;          /* iterate over heap elements */
  let max_code = -1; /* largest code with non zero frequency */
  let node;          /* new node being created */

  /* Construct the initial heap, with least frequent element in
   * heap[SMALLEST]. The sons of heap[n] are heap[2*n] and heap[2*n+1].
   * heap[0] is not used.
   */
  s.heap_len = 0;
  s.heap_max = HEAP_SIZE;

  for (n = 0; n < elems; n++) {
    if (tree[n * 2]/*.Freq*/ !== 0) {
      s.heap[++s.heap_len] = max_code = n;
      s.depth[n] = 0;

    } else {
      tree[n * 2 + 1]/*.Len*/ = 0;
    }
  }

  /* The pkzip format requires that at least one distance code exists,
   * and that at least one bit should be sent even if there is only one
   * possible code. So to avoid special checks later on we force at least
   * two codes of non zero frequency.
   */
  while (s.heap_len < 2) {
    node = s.heap[++s.heap_len] = (max_code < 2 ? ++max_code : 0);
    tree[node * 2]/*.Freq*/ = 1;
    s.depth[node] = 0;
    s.opt_len--;

    if (has_stree) {
      s.static_len -= stree[node * 2 + 1]/*.Len*/;
    }
    /* node is 0 or 1 so it does not have extra bits */
  }
  desc.max_code = max_code;

  /* The elements heap[heap_len/2+1 .. heap_len] are leaves of the tree,
   * establish sub-heaps of increasing lengths:
   */
  for (n = (s.heap_len >> 1/*int /2*/); n >= 1; n--) { pqdownheap(s, tree, n); }

  /* Construct the Huffman tree by repeatedly combining the least two
   * frequent nodes.
   */
  node = elems;              /* next internal node of the tree */
  do {
    //pqremove(s, tree, n);  /* n = node of least frequency */
    /*** pqremove ***/
    n = s.heap[1/*SMALLEST*/];
    s.heap[1/*SMALLEST*/] = s.heap[s.heap_len--];
    pqdownheap(s, tree, 1/*SMALLEST*/);
    /***/

    m = s.heap[1/*SMALLEST*/]; /* m = node of next least frequency */

    s.heap[--s.heap_max] = n; /* keep the nodes sorted by frequency */
    s.heap[--s.heap_max] = m;

    /* Create a new node father of n and m */
    tree[node * 2]/*.Freq*/ = tree[n * 2]/*.Freq*/ + tree[m * 2]/*.Freq*/;
    s.depth[node] = (s.depth[n] >= s.depth[m] ? s.depth[n] : s.depth[m]) + 1;
    tree[n * 2 + 1]/*.Dad*/ = tree[m * 2 + 1]/*.Dad*/ = node;

    /* and insert the new node in the heap */
    s.heap[1/*SMALLEST*/] = node++;
    pqdownheap(s, tree, 1/*SMALLEST*/);

  } while (s.heap_len >= 2);

  s.heap[--s.heap_max] = s.heap[1/*SMALLEST*/];

  /* At this point, the fields freq and dad are set. We can now
   * generate the bit lengths.
   */
  gen_bitlen(s, desc);

  /* The field len is now set, we can generate the bit codes */
  gen_codes(tree, max_code, s.bl_count);
};


/* ===========================================================================
 * Scan a literal or distance tree to determine the frequencies of the codes
 * in the bit length tree.
 */
const scan_tree = (s, tree, max_code) =>
//    deflate_state *s;
//    ct_data *tree;   /* the tree to be scanned */
//    int max_code;    /* and its largest code of non zero frequency */
{
  let n;                     /* iterates over all tree elements */
  let prevlen = -1;          /* last emitted length */
  let curlen;                /* length of current code */

  let nextlen = tree[0 * 2 + 1]/*.Len*/; /* length of next code */

  let count = 0;             /* repeat count of the current code */
  let max_count = 7;         /* max repeat count */
  let min_count = 4;         /* min repeat count */

  if (nextlen === 0) {
    max_count = 138;
    min_count = 3;
  }
  tree[(max_code + 1) * 2 + 1]/*.Len*/ = 0xffff; /* guard */

  for (n = 0; n <= max_code; n++) {
    curlen = nextlen;
    nextlen = tree[(n + 1) * 2 + 1]/*.Len*/;

    if (++count < max_count && curlen === nextlen) {
      continue;

    } else if (count < min_count) {
      s.bl_tree[curlen * 2]/*.Freq*/ += count;

    } else if (curlen !== 0) {

      if (curlen !== prevlen) { s.bl_tree[curlen * 2]/*.Freq*/++; }
      s.bl_tree[REP_3_6 * 2]/*.Freq*/++;

    } else if (count <= 10) {
      s.bl_tree[REPZ_3_10 * 2]/*.Freq*/++;

    } else {
      s.bl_tree[REPZ_11_138 * 2]/*.Freq*/++;
    }

    count = 0;
    prevlen = curlen;

    if (nextlen === 0) {
      max_count = 138;
      min_count = 3;

    } else if (curlen === nextlen) {
      max_count = 6;
      min_count = 3;

    } else {
      max_count = 7;
      min_count = 4;
    }
  }
};


/* ===========================================================================
 * Send a literal or distance tree in compressed form, using the codes in
 * bl_tree.
 */
const send_tree = (s, tree, max_code) =>
//    deflate_state *s;
//    ct_data *tree; /* the tree to be scanned */
//    int max_code;       /* and its largest code of non zero frequency */
{
  let n;                     /* iterates over all tree elements */
  let prevlen = -1;          /* last emitted length */
  let curlen;                /* length of current code */

  let nextlen = tree[0 * 2 + 1]/*.Len*/; /* length of next code */

  let count = 0;             /* repeat count of the current code */
  let max_count = 7;         /* max repeat count */
  let min_count = 4;         /* min repeat count */

  /* tree[max_code+1].Len = -1; */  /* guard already set */
  if (nextlen === 0) {
    max_count = 138;
    min_count = 3;
  }

  for (n = 0; n <= max_code; n++) {
    curlen = nextlen;
    nextlen = tree[(n + 1) * 2 + 1]/*.Len*/;

    if (++count < max_count && curlen === nextlen) {
      continue;

    } else if (count < min_count) {
      do { send_code(s, curlen, s.bl_tree); } while (--count !== 0);

    } else if (curlen !== 0) {
      if (curlen !== prevlen) {
        send_code(s, curlen, s.bl_tree);
        count--;
      }
      //Assert(count >= 3 && count <= 6, " 3_6?");
      send_code(s, REP_3_6, s.bl_tree);
      send_bits(s, count - 3, 2);

    } else if (count <= 10) {
      send_code(s, REPZ_3_10, s.bl_tree);
      send_bits(s, count - 3, 3);

    } else {
      send_code(s, REPZ_11_138, s.bl_tree);
      send_bits(s, count - 11, 7);
    }

    count = 0;
    prevlen = curlen;
    if (nextlen === 0) {
      max_count = 138;
      min_count = 3;

    } else if (curlen === nextlen) {
      max_count = 6;
      min_count = 3;

    } else {
      max_count = 7;
      min_count = 4;
    }
  }
};


/* ===========================================================================
 * Construct the Huffman tree for the bit lengths and return the index in
 * bl_order of the last bit length code to send.
 */
const build_bl_tree = (s) => {

  let max_blindex;  /* index of last bit length code of non zero freq */

  /* Determine the bit length frequencies for literal and distance trees */
  scan_tree(s, s.dyn_ltree, s.l_desc.max_code);
  scan_tree(s, s.dyn_dtree, s.d_desc.max_code);

  /* Build the bit length tree: */
  build_tree(s, s.bl_desc);
  /* opt_len now includes the length of the tree representations, except
   * the lengths of the bit lengths codes and the 5+5+4 bits for the counts.
   */

  /* Determine the number of bit length codes to send. The pkzip format
   * requires that at least 4 bit length codes be sent. (appnote.txt says
   * 3 but the actual value used is 4.)
   */
  for (max_blindex = BL_CODES - 1; max_blindex >= 3; max_blindex--) {
    if (s.bl_tree[bl_order[max_blindex] * 2 + 1]/*.Len*/ !== 0) {
      break;
    }
  }
  /* Update opt_len to include the bit length tree and counts */
  s.opt_len += 3 * (max_blindex + 1) + 5 + 5 + 4;
  //Tracev((stderr, "\ndyn trees: dyn %ld, stat %ld",
  //        s->opt_len, s->static_len));

  return max_blindex;
};


/* ===========================================================================
 * Send the header for a block using dynamic Huffman trees: the counts, the
 * lengths of the bit length codes, the literal tree and the distance tree.
 * IN assertion: lcodes >= 257, dcodes >= 1, blcodes >= 4.
 */
const send_all_trees = (s, lcodes, dcodes, blcodes) =>
//    deflate_state *s;
//    int lcodes, dcodes, blcodes; /* number of codes for each tree */
{
  let rank;                    /* index in bl_order */

  //Assert (lcodes >= 257 && dcodes >= 1 && blcodes >= 4, "not enough codes");
  //Assert (lcodes <= L_CODES && dcodes <= D_CODES && blcodes <= BL_CODES,
  //        "too many codes");
  //Tracev((stderr, "\nbl counts: "));
  send_bits(s, lcodes - 257, 5); /* not +255 as stated in appnote.txt */
  send_bits(s, dcodes - 1,   5);
  send_bits(s, blcodes - 4,  4); /* not -3 as stated in appnote.txt */
  for (rank = 0; rank < blcodes; rank++) {
    //Tracev((stderr, "\nbl code %2d ", bl_order[rank]));
    send_bits(s, s.bl_tree[bl_order[rank] * 2 + 1]/*.Len*/, 3);
  }
  //Tracev((stderr, "\nbl tree: sent %ld", s->bits_sent));

  send_tree(s, s.dyn_ltree, lcodes - 1); /* literal tree */
  //Tracev((stderr, "\nlit tree: sent %ld", s->bits_sent));

  send_tree(s, s.dyn_dtree, dcodes - 1); /* distance tree */
  //Tracev((stderr, "\ndist tree: sent %ld", s->bits_sent));
};


/* ===========================================================================
 * Check if the data type is TEXT or BINARY, using the following algorithm:
 * - TEXT if the two conditions below are satisfied:
 *    a) There are no non-portable control characters belonging to the
 *       "black list" (0..6, 14..25, 28..31).
 *    b) There is at least one printable character belonging to the
 *       "white list" (9 {TAB}, 10 {LF}, 13 {CR}, 32..255).
 * - BINARY otherwise.
 * - The following partially-portable control characters form a
 *   "gray list" that is ignored in this detection algorithm:
 *   (7 {BEL}, 8 {BS}, 11 {VT}, 12 {FF}, 26 {SUB}, 27 {ESC}).
 * IN assertion: the fields Freq of dyn_ltree are set.
 */
const detect_data_type = (s) => {
  /* black_mask is the bit mask of black-listed bytes
   * set bits 0..6, 14..25, and 28..31
   * 0xf3ffc07f = binary 11110011111111111100000001111111
   */
  let black_mask = 0xf3ffc07f;
  let n;

  /* Check for non-textual ("black-listed") bytes. */
  for (n = 0; n <= 31; n++, black_mask >>>= 1) {
    if ((black_mask & 1) && (s.dyn_ltree[n * 2]/*.Freq*/ !== 0)) {
      return Z_BINARY;
    }
  }

  /* Check for textual ("white-listed") bytes. */
  if (s.dyn_ltree[9 * 2]/*.Freq*/ !== 0 || s.dyn_ltree[10 * 2]/*.Freq*/ !== 0 ||
      s.dyn_ltree[13 * 2]/*.Freq*/ !== 0) {
    return Z_TEXT;
  }
  for (n = 32; n < LITERALS; n++) {
    if (s.dyn_ltree[n * 2]/*.Freq*/ !== 0) {
      return Z_TEXT;
    }
  }

  /* There are no "black-listed" or "white-listed" bytes:
   * this stream either is empty or has tolerated ("gray-listed") bytes only.
   */
  return Z_BINARY;
};


let static_init_done = false;

/* ===========================================================================
 * Initialize the tree data structures for a new zlib stream.
 */
const _tr_init = (s) =>
{

  if (!static_init_done) {
    tr_static_init();
    static_init_done = true;
  }

  s.l_desc  = new TreeDesc(s.dyn_ltree, static_l_desc);
  s.d_desc  = new TreeDesc(s.dyn_dtree, static_d_desc);
  s.bl_desc = new TreeDesc(s.bl_tree, static_bl_desc);

  s.bi_buf = 0;
  s.bi_valid = 0;

  /* Initialize the first block of the first file: */
  init_block(s);
};


/* ===========================================================================
 * Send a stored block
 */
const _tr_stored_block = (s, buf, stored_len, last) =>
//DeflateState *s;
//charf *buf;       /* input block */
//ulg stored_len;   /* length of input block */
//int last;         /* one if this is the last block for a file */
{
  send_bits(s, (STORED_BLOCK << 1) + (last ? 1 : 0), 3);    /* send block type */
  copy_block(s, buf, stored_len, true); /* with header */
};


/* ===========================================================================
 * Send one empty static block to give enough lookahead for inflate.
 * This takes 10 bits, of which 7 may remain in the bit buffer.
 */
const _tr_align = (s) => {
  send_bits(s, STATIC_TREES << 1, 3);
  send_code(s, END_BLOCK, static_ltree);
  bi_flush(s);
};


/* ===========================================================================
 * Determine the best encoding for the current block: dynamic trees, static
 * trees or store, and output the encoded block to the zip file.
 */
const _tr_flush_block = (s, buf, stored_len, last) =>
//DeflateState *s;
//charf *buf;       /* input block, or NULL if too old */
//ulg stored_len;   /* length of input block */
//int last;         /* one if this is the last block for a file */
{
  let opt_lenb, static_lenb;  /* opt_len and static_len in bytes */
  let max_blindex = 0;        /* index of last bit length code of non zero freq */

  /* Build the Huffman trees unless a stored block is forced */
  if (s.level > 0) {

    /* Check if the file is binary or text */
    if (s.strm.data_type === Z_UNKNOWN) {
      s.strm.data_type = detect_data_type(s);
    }

    /* Construct the literal and distance trees */
    build_tree(s, s.l_desc);
    // Tracev((stderr, "\nlit data: dyn %ld, stat %ld", s->opt_len,
    //        s->static_len));

    build_tree(s, s.d_desc);
    // Tracev((stderr, "\ndist data: dyn %ld, stat %ld", s->opt_len,
    //        s->static_len));
    /* At this point, opt_len and static_len are the total bit lengths of
     * the compressed block data, excluding the tree representations.
     */

    /* Build the bit length tree for the above two trees, and get the index
     * in bl_order of the last bit length code to send.
     */
    max_blindex = build_bl_tree(s);

    /* Determine the best encoding. Compute the block lengths in bytes. */
    opt_lenb = (s.opt_len + 3 + 7) >>> 3;
    static_lenb = (s.static_len + 3 + 7) >>> 3;

    // Tracev((stderr, "\nopt %lu(%lu) stat %lu(%lu) stored %lu lit %u ",
    //        opt_lenb, s->opt_len, static_lenb, s->static_len, stored_len,
    //        s->last_lit));

    if (static_lenb <= opt_lenb) { opt_lenb = static_lenb; }

  } else {
    // Assert(buf != (char*)0, "lost buf");
    opt_lenb = static_lenb = stored_len + 5; /* force a stored block */
  }

  if ((stored_len + 4 <= opt_lenb) && (buf !== -1)) {
    /* 4: two words for the lengths */

    /* The test buf != NULL is only necessary if LIT_BUFSIZE > WSIZE.
     * Otherwise we can't have processed more than WSIZE input bytes since
     * the last block flush, because compression would have been
     * successful. If LIT_BUFSIZE <= WSIZE, it is never too late to
     * transform a block into a stored block.
     */
    _tr_stored_block(s, buf, stored_len, last);

  } else if (s.strategy === Z_FIXED || static_lenb === opt_lenb) {

    send_bits(s, (STATIC_TREES << 1) + (last ? 1 : 0), 3);
    compress_block(s, static_ltree, static_dtree);

  } else {
    send_bits(s, (DYN_TREES << 1) + (last ? 1 : 0), 3);
    send_all_trees(s, s.l_desc.max_code + 1, s.d_desc.max_code + 1, max_blindex + 1);
    compress_block(s, s.dyn_ltree, s.dyn_dtree);
  }
  // Assert (s->compressed_len == s->bits_sent, "bad compressed size");
  /* The above check is made mod 2^32, for files larger than 512 MB
   * and uLong implemented on 32 bits.
   */
  init_block(s);

  if (last) {
    bi_windup(s);
  }
  // Tracev((stderr,"\ncomprlen %lu(%lu) ", s->compressed_len>>3,
  //       s->compressed_len-7*last));
};

/* ===========================================================================
 * Save the match info and tally the frequency counts. Return true if
 * the current block must be flushed.
 */
const _tr_tally = (s, dist, lc) =>
//    deflate_state *s;
//    unsigned dist;  /* distance of matched string */
//    unsigned lc;    /* match length-MIN_MATCH or unmatched char (if dist==0) */
{
  //let out_length, in_length, dcode;

  s.pending_buf[s.d_buf + s.last_lit * 2]     = (dist >>> 8) & 0xff;
  s.pending_buf[s.d_buf + s.last_lit * 2 + 1] = dist & 0xff;

  s.pending_buf[s.l_buf + s.last_lit] = lc & 0xff;
  s.last_lit++;

  if (dist === 0) {
    /* lc is the unmatched char */
    s.dyn_ltree[lc * 2]/*.Freq*/++;
  } else {
    s.matches++;
    /* Here, lc is the match length - MIN_MATCH */
    dist--;             /* dist = match distance - 1 */
    //Assert((ush)dist < (ush)MAX_DIST(s) &&
    //       (ush)lc <= (ush)(MAX_MATCH-MIN_MATCH) &&
    //       (ush)d_code(dist) < (ush)D_CODES,  "_tr_tally: bad match");

    s.dyn_ltree[(_length_code[lc] + LITERALS + 1) * 2]/*.Freq*/++;
    s.dyn_dtree[d_code(dist) * 2]/*.Freq*/++;
  }

// (!) This block is disabled in zlib defaults,
// don't enable it for binary compatibility

//#ifdef TRUNCATE_BLOCK
//  /* Try to guess if it is profitable to stop the current block here */
//  if ((s.last_lit & 0x1fff) === 0 && s.level > 2) {
//    /* Compute an upper bound for the compressed length */
//    out_length = s.last_lit*8;
//    in_length = s.strstart - s.block_start;
//
//    for (dcode = 0; dcode < D_CODES; dcode++) {
//      out_length += s.dyn_dtree[dcode*2]/*.Freq*/ * (5 + extra_dbits[dcode]);
//    }
//    out_length >>>= 3;
//    //Tracev((stderr,"\nlast_lit %u, in %ld, out ~%ld(%ld%%) ",
//    //       s->last_lit, in_length, out_length,
//    //       100L - out_length*100L/in_length));
//    if (s.matches < (s.last_lit>>1)/*int /2*/ && out_length < (in_length>>1)/*int /2*/) {
//      return true;
//    }
//  }
//#endif

  return (s.last_lit === s.lit_bufsize - 1);
  /* We avoid equality with lit_bufsize because of wraparound at 64K
   * on 16 bit machines and because stored blocks are restricted to
   * 64K-1 bytes.
   */
};

module.exports._tr_init  = _tr_init;
module.exports._tr_stored_block = _tr_stored_block;
module.exports._tr_flush_block  = _tr_flush_block;
module.exports._tr_tally = _tr_tally;
module.exports._tr_align = _tr_align;


/***/ }),

/***/ "./node_modules/pako/lib/zlib/zstream.js":
/*!***********************************************!*\
  !*** ./node_modules/pako/lib/zlib/zstream.js ***!
  \***********************************************/
/***/ (function(module) {

"use strict";


// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

function ZStream() {
  /* next input byte */
  this.input = null; // JS specific, because we have no pointers
  this.next_in = 0;
  /* number of bytes available at input */
  this.avail_in = 0;
  /* total number of input bytes read so far */
  this.total_in = 0;
  /* next output byte should be put there */
  this.output = null; // JS specific, because we have no pointers
  this.next_out = 0;
  /* remaining free space at output */
  this.avail_out = 0;
  /* total number of bytes output so far */
  this.total_out = 0;
  /* last error message, NULL if no error */
  this.msg = ''/*Z_NULL*/;
  /* not visible by applications */
  this.state = null;
  /* best guess about the data type: binary or text */
  this.data_type = 2/*Z_UNKNOWN*/;
  /* adler32 value of the uncompressed data */
  this.adler = 0;
}

module.exports = ZStream;


/***/ }),

/***/ "./node_modules/uuid/index.js":
/*!************************************!*\
  !*** ./node_modules/uuid/index.js ***!
  \************************************/
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

var v1 = __webpack_require__(/*! ./v1 */ "./node_modules/uuid/v1.js");
var v4 = __webpack_require__(/*! ./v4 */ "./node_modules/uuid/v4.js");

var uuid = v4;
uuid.v1 = v1;
uuid.v4 = v4;

module.exports = uuid;


/***/ }),

/***/ "./node_modules/uuid/lib/bytesToUuid.js":
/*!**********************************************!*\
  !*** ./node_modules/uuid/lib/bytesToUuid.js ***!
  \**********************************************/
/***/ (function(module) {

/**
 * Convert array of 16 byte values to UUID string format of the form:
 * XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
 */
var byteToHex = [];
for (var i = 0; i < 256; ++i) {
  byteToHex[i] = (i + 0x100).toString(16).substr(1);
}

function bytesToUuid(buf, offset) {
  var i = offset || 0;
  var bth = byteToHex;
  // join used to fix memory issue caused by concatenation: https://bugs.chromium.org/p/v8/issues/detail?id=3175#c4
  return ([
    bth[buf[i++]], bth[buf[i++]],
    bth[buf[i++]], bth[buf[i++]], '-',
    bth[buf[i++]], bth[buf[i++]], '-',
    bth[buf[i++]], bth[buf[i++]], '-',
    bth[buf[i++]], bth[buf[i++]], '-',
    bth[buf[i++]], bth[buf[i++]],
    bth[buf[i++]], bth[buf[i++]],
    bth[buf[i++]], bth[buf[i++]]
  ]).join('');
}

module.exports = bytesToUuid;


/***/ }),

/***/ "./node_modules/uuid/lib/rng-browser.js":
/*!**********************************************!*\
  !*** ./node_modules/uuid/lib/rng-browser.js ***!
  \**********************************************/
/***/ (function(module) {

// Unique ID creation requires a high quality random # generator.  In the
// browser this is a little complicated due to unknown quality of Math.random()
// and inconsistent support for the `crypto` API.  We do the best we can via
// feature-detection

// getRandomValues needs to be invoked in a context where "this" is a Crypto
// implementation. Also, find the complete implementation of crypto on IE11.
var getRandomValues = (typeof(crypto) != 'undefined' && crypto.getRandomValues && crypto.getRandomValues.bind(crypto)) ||
                      (typeof(msCrypto) != 'undefined' && typeof window.msCrypto.getRandomValues == 'function' && msCrypto.getRandomValues.bind(msCrypto));

if (getRandomValues) {
  // WHATWG crypto RNG - http://wiki.whatwg.org/wiki/Crypto
  var rnds8 = new Uint8Array(16); // eslint-disable-line no-undef

  module.exports = function whatwgRNG() {
    getRandomValues(rnds8);
    return rnds8;
  };
} else {
  // Math.random()-based (RNG)
  //
  // If all else fails, use Math.random().  It's fast, but is of unspecified
  // quality.
  var rnds = new Array(16);

  module.exports = function mathRNG() {
    for (var i = 0, r; i < 16; i++) {
      if ((i & 0x03) === 0) r = Math.random() * 0x100000000;
      rnds[i] = r >>> ((i & 0x03) << 3) & 0xff;
    }

    return rnds;
  };
}


/***/ }),

/***/ "./node_modules/uuid/v1.js":
/*!*********************************!*\
  !*** ./node_modules/uuid/v1.js ***!
  \*********************************/
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

var rng = __webpack_require__(/*! ./lib/rng */ "./node_modules/uuid/lib/rng-browser.js");
var bytesToUuid = __webpack_require__(/*! ./lib/bytesToUuid */ "./node_modules/uuid/lib/bytesToUuid.js");

// **`v1()` - Generate time-based UUID**
//
// Inspired by https://github.com/LiosK/UUID.js
// and http://docs.python.org/library/uuid.html

var _nodeId;
var _clockseq;

// Previous uuid creation time
var _lastMSecs = 0;
var _lastNSecs = 0;

// See https://github.com/uuidjs/uuid for API details
function v1(options, buf, offset) {
  var i = buf && offset || 0;
  var b = buf || [];

  options = options || {};
  var node = options.node || _nodeId;
  var clockseq = options.clockseq !== undefined ? options.clockseq : _clockseq;

  // node and clockseq need to be initialized to random values if they're not
  // specified.  We do this lazily to minimize issues related to insufficient
  // system entropy.  See #189
  if (node == null || clockseq == null) {
    var seedBytes = rng();
    if (node == null) {
      // Per 4.5, create and 48-bit node id, (47 random bits + multicast bit = 1)
      node = _nodeId = [
        seedBytes[0] | 0x01,
        seedBytes[1], seedBytes[2], seedBytes[3], seedBytes[4], seedBytes[5]
      ];
    }
    if (clockseq == null) {
      // Per 4.2.2, randomize (14 bit) clockseq
      clockseq = _clockseq = (seedBytes[6] << 8 | seedBytes[7]) & 0x3fff;
    }
  }

  // UUID timestamps are 100 nano-second units since the Gregorian epoch,
  // (1582-10-15 00:00).  JSNumbers aren't precise enough for this, so
  // time is handled internally as 'msecs' (integer milliseconds) and 'nsecs'
  // (100-nanoseconds offset from msecs) since unix epoch, 1970-01-01 00:00.
  var msecs = options.msecs !== undefined ? options.msecs : new Date().getTime();

  // Per 4.2.1.2, use count of uuid's generated during the current clock
  // cycle to simulate higher resolution clock
  var nsecs = options.nsecs !== undefined ? options.nsecs : _lastNSecs + 1;

  // Time since last uuid creation (in msecs)
  var dt = (msecs - _lastMSecs) + (nsecs - _lastNSecs)/10000;

  // Per 4.2.1.2, Bump clockseq on clock regression
  if (dt < 0 && options.clockseq === undefined) {
    clockseq = clockseq + 1 & 0x3fff;
  }

  // Reset nsecs if clock regresses (new clockseq) or we've moved onto a new
  // time interval
  if ((dt < 0 || msecs > _lastMSecs) && options.nsecs === undefined) {
    nsecs = 0;
  }

  // Per 4.2.1.2 Throw error if too many uuids are requested
  if (nsecs >= 10000) {
    throw new Error('uuid.v1(): Can\'t create more than 10M uuids/sec');
  }

  _lastMSecs = msecs;
  _lastNSecs = nsecs;
  _clockseq = clockseq;

  // Per 4.1.4 - Convert from unix epoch to Gregorian epoch
  msecs += 12219292800000;

  // `time_low`
  var tl = ((msecs & 0xfffffff) * 10000 + nsecs) % 0x100000000;
  b[i++] = tl >>> 24 & 0xff;
  b[i++] = tl >>> 16 & 0xff;
  b[i++] = tl >>> 8 & 0xff;
  b[i++] = tl & 0xff;

  // `time_mid`
  var tmh = (msecs / 0x100000000 * 10000) & 0xfffffff;
  b[i++] = tmh >>> 8 & 0xff;
  b[i++] = tmh & 0xff;

  // `time_high_and_version`
  b[i++] = tmh >>> 24 & 0xf | 0x10; // include version
  b[i++] = tmh >>> 16 & 0xff;

  // `clock_seq_hi_and_reserved` (Per 4.2.2 - include variant)
  b[i++] = clockseq >>> 8 | 0x80;

  // `clock_seq_low`
  b[i++] = clockseq & 0xff;

  // `node`
  for (var n = 0; n < 6; ++n) {
    b[i + n] = node[n];
  }

  return buf ? buf : bytesToUuid(b);
}

module.exports = v1;


/***/ }),

/***/ "./node_modules/uuid/v4.js":
/*!*********************************!*\
  !*** ./node_modules/uuid/v4.js ***!
  \*********************************/
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

var rng = __webpack_require__(/*! ./lib/rng */ "./node_modules/uuid/lib/rng-browser.js");
var bytesToUuid = __webpack_require__(/*! ./lib/bytesToUuid */ "./node_modules/uuid/lib/bytesToUuid.js");

function v4(options, buf, offset) {
  var i = buf && offset || 0;

  if (typeof(options) == 'string') {
    buf = options === 'binary' ? new Array(16) : null;
    options = null;
  }
  options = options || {};

  var rnds = options.random || (options.rng || rng)();

  // Per 4.4, set bits for version and `clock_seq_hi_and_reserved`
  rnds[6] = (rnds[6] & 0x0f) | 0x40;
  rnds[8] = (rnds[8] & 0x3f) | 0x80;

  // Copy bytes to buffer, if provided
  if (buf) {
    for (var ii = 0; ii < 16; ++ii) {
      buf[i + ii] = rnds[ii];
    }
  }

  return buf || bytesToUuid(rnds);
}

module.exports = v4;


/***/ }),

/***/ "./src/automerge.js":
/*!**************************!*\
  !*** ./src/automerge.js ***!
  \**************************/
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

const uuid = __webpack_require__(/*! ./uuid */ "./src/uuid.js")
const Frontend = __webpack_require__(/*! ../frontend */ "./frontend/index.js")
const { OPTIONS } = __webpack_require__(/*! ../frontend/constants */ "./frontend/constants.js")
const { encodeChange, decodeChange } = __webpack_require__(/*! ../backend/columnar */ "./backend/columnar.js")
const { isObject } = __webpack_require__(/*! ./common */ "./src/common.js")
let backend = __webpack_require__(/*! ../backend */ "./backend/index.js") // mutable: can be overridden with setDefaultBackend()

/**
 * Automerge.* API
 * The functions in this file constitute the publicly facing Automerge API which combines
 * the features of the Frontend (a document interface) and the backend (CRDT operations)
 */

function init(options) {
  if (typeof options === 'string') {
    options = {actorId: options}
  } else if (typeof options === 'undefined') {
    options = {}
  } else if (!isObject(options)) {
    throw new TypeError(`Unsupported options for init(): ${options}`)
  }
  return Frontend.init(Object.assign({backend}, options))
}

/**
 * Returns a new document object initialized with the given state.
 */
function from(initialState, options) {
  const changeOpts = {message: 'Initialization'}
  return change(init(options), changeOpts, doc => Object.assign(doc, initialState))
}

function change(doc, options, callback) {
  const [newDoc] = Frontend.change(doc, options, callback)
  return newDoc
}

function emptyChange(doc, options) {
  const [newDoc] = Frontend.emptyChange(doc, options)
  return newDoc
}

function clone(doc, options = {}) {
  const state = backend.clone(Frontend.getBackendState(doc, 'clone'))
  return applyPatch(init(options), backend.getPatch(state), state, [], options)
}

function free(doc) {
  backend.free(Frontend.getBackendState(doc, 'free'))
}

function load(data, options = {}) {
  const state = backend.load(data)
  return applyPatch(init(options), backend.getPatch(state), state, [data], options)
}

function save(doc) {
  return backend.save(Frontend.getBackendState(doc, 'save'))
}

function merge(localDoc, remoteDoc) {
  const localState = Frontend.getBackendState(localDoc, 'merge')
  const remoteState = Frontend.getBackendState(remoteDoc, 'merge', 'second')
  if (Frontend.getActorId(localDoc) === Frontend.getActorId(remoteDoc)) {
    throw new RangeError('Cannot merge an actor with itself')
  }
  const changes = backend.getChangesAdded(localState, remoteState)
  const [updatedDoc] = applyChanges(localDoc, changes)
  return updatedDoc
}

function getChanges(oldDoc, newDoc) {
  const oldState = Frontend.getBackendState(oldDoc, 'getChanges')
  const newState = Frontend.getBackendState(newDoc, 'getChanges', 'second')
  return backend.getChanges(newState, backend.getHeads(oldState))
}

function getAllChanges(doc) {
  return backend.getAllChanges(Frontend.getBackendState(doc, 'getAllChanges'))
}

function applyPatch(doc, patch, backendState, changes, options) {
  const newDoc = Frontend.applyPatch(doc, patch, backendState)
  const patchCallback = options.patchCallback || doc[OPTIONS].patchCallback
  if (patchCallback) {
    patchCallback(patch, doc, newDoc, false, changes)
  }
  return newDoc
}

function applyChanges(doc, changes, options = {}) {
  const oldState = Frontend.getBackendState(doc, 'applyChanges')
  const [newState, patch] = backend.applyChanges(oldState, changes)
  return [applyPatch(doc, patch, newState, changes, options), patch]
}

function equals(val1, val2) {
  if (!isObject(val1) || !isObject(val2)) return val1 === val2
  const keys1 = Object.keys(val1).sort(), keys2 = Object.keys(val2).sort()
  if (keys1.length !== keys2.length) return false
  for (let i = 0; i < keys1.length; i++) {
    if (keys1[i] !== keys2[i]) return false
    if (!equals(val1[keys1[i]], val2[keys2[i]])) return false
  }
  return true
}

function getHistory(doc) {
  const actor = Frontend.getActorId(doc)
  const history = getAllChanges(doc)
  return history.map((change, index) => ({
      get change () {
        return decodeChange(change)
      },
      get snapshot () {
        const state = backend.loadChanges(backend.init(), history.slice(0, index + 1))
        return Frontend.applyPatch(init(actor), backend.getPatch(state), state)
      }
    })
  )
}

function generateSyncMessage(doc, syncState) {
  const state = Frontend.getBackendState(doc, 'generateSyncMessage')
  return backend.generateSyncMessage(state, syncState)
}

function receiveSyncMessage(doc, oldSyncState, message) {
  const oldBackendState = Frontend.getBackendState(doc, 'receiveSyncMessage')
  const [backendState, syncState, patch] = backend.receiveSyncMessage(oldBackendState, oldSyncState, message)
  if (!patch) return [doc, syncState, patch]

  // The patchCallback is passed as argument all changes that are applied.
  // We get those from the sync message if a patchCallback is present.
  let changes = null
  if (doc[OPTIONS].patchCallback) {
    changes = backend.decodeSyncMessage(message).changes
  }
  return [applyPatch(doc, patch, backendState, changes, {}), syncState, patch]
}

function initSyncState() {
  return backend.initSyncState()
}

/**
 * Replaces the default backend implementation with a different one.
 * This allows you to switch to using the Rust/WebAssembly implementation.
 */
function setDefaultBackend(newBackend) {
  backend = newBackend
}

module.exports = {
  init, from, change, emptyChange, clone, free,
  load, save, merge, getChanges, getAllChanges, applyChanges,
  encodeChange, decodeChange, equals, getHistory, uuid,
  Frontend, setDefaultBackend, generateSyncMessage, receiveSyncMessage, initSyncState,
  get Backend() { return backend }
}

for (let name of ['getObjectId', 'getObjectById', 'getActorId',
     'setActorId', 'getConflicts', 'getLastLocalChange',
     'Text', 'Table', 'Counter', 'Observable', 'Int', 'Uint', 'Float64']) {
  module.exports[name] = Frontend[name]
}


/***/ }),

/***/ "./src/common.js":
/*!***********************!*\
  !*** ./src/common.js ***!
  \***********************/
/***/ (function(module) {

function isObject(obj) {
  return typeof obj === 'object' && obj !== null
}

/**
 * Returns a shallow copy of the object `obj`. Faster than `Object.assign({}, obj)`.
 * https://jsperf.com/cloning-large-objects/1
 */
function copyObject(obj) {
  if (!isObject(obj)) return {}
  let copy = {}
  for (let key of Object.keys(obj)) {
    copy[key] = obj[key]
  }
  return copy
}

/**
 * Takes a string in the form that is used to identify operations (a counter concatenated
 * with an actor ID, separated by an `@` sign) and returns an object `{counter, actorId}`.
 */
function parseOpId(opId) {
  const match = /^(\d+)@(.*)$/.exec(opId || '')
  if (!match) {
    throw new RangeError(`Not a valid opId: ${opId}`)
  }
  return {counter: parseInt(match[1], 10), actorId: match[2]}
}

/**
 * Returns true if the two byte arrays contain the same data, false if not.
 */
function equalBytes(array1, array2) {
  if (!(array1 instanceof Uint8Array) || !(array2 instanceof Uint8Array)) {
    throw new TypeError('equalBytes can only compare Uint8Arrays')
  }
  if (array1.byteLength !== array2.byteLength) return false
  for (let i = 0; i < array1.byteLength; i++) {
    if (array1[i] !== array2[i]) return false
  }
  return true
}

/**
 * Creates an array containing the value `null` repeated `length` times.
 */
function createArrayOfNulls(length) {
  const array = new Array(length)
  for (let i = 0; i < length; i++) array[i] = null
  return array
}

module.exports = {
  isObject, copyObject, parseOpId, equalBytes, createArrayOfNulls
}


/***/ }),

/***/ "./src/uuid.js":
/*!*********************!*\
  !*** ./src/uuid.js ***!
  \*********************/
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

const { v4: uuid } = __webpack_require__(/*! uuid */ "./node_modules/uuid/index.js")

function defaultFactory() {
  return uuid().replace(/-/g, '')
}

let factory = defaultFactory

function makeUuid() {
  return factory()
}

makeUuid.setFactory = newFactory => { factory = newFactory }
makeUuid.reset = () => { factory = defaultFactory }

module.exports = makeUuid


/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		if(__webpack_module_cache__[moduleId]) {
/******/ 			return __webpack_module_cache__[moduleId].exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module is referenced by other modules so it can't be inlined
/******/ 	var __webpack_exports__ = __webpack_require__("./src/automerge.js");
/******/ 	
/******/ 	return __webpack_exports__;
/******/ })()
;
});
//# sourceMappingURL=automerge.js.map