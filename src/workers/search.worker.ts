import { SearchIndex, type SearchWorkerReply, type SearchWorkerRequest } from '../lib/searchIndex';

const scope = globalThis as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<SearchWorkerRequest>) => void): void;
  postMessage(message: SearchWorkerReply): void;
};
const index = new SearchIndex();
let latestSequence = 0;

scope.addEventListener('message', (event) => {
  const request = event.data;
  if (request.type === 'sync') { index.applySync(request); return; }
  if (request.type !== 'query' || request.generation !== index.generation || request.sequence < latestSequence) return;
  latestSequence = request.sequence;
  void index.searchAsync(request.query, {
    shouldContinue: () => request.generation === index.generation && request.sequence === latestSequence,
  }).then((matches) => {
    if (matches && request.generation === index.generation && request.sequence === latestSequence) {
      scope.postMessage({ type: 'result', generation: request.generation, sequence: request.sequence, ids: [...matches] });
    }
  });
});
