# Node Tracker for Symbol PoC

## 1. これは何ですか？

これまではアプリの起動に際してユーザーがノードURLを明示的に設定していました。
そこで、この小規模なライブラリ「Node Tracker for Symbol」を使うことで、アプリが全ノードをトラッキングし最適なものを自動的に選択できるようになります。
その為ユーザーはノードURLをいちいち設定する必要が無くなります。

Node Tracker for Symbol ではノードリストを収集する為に [Symbol Statistics Service](https://github.com/symbol/statistics-service)
（メインネットの場合 `https://symbol.services/nodes` 、テストネットの場合 `https://testnet.symbol.services/nodes`) を使用する想定です。

取得した全ノードに対して「ヘルスチェック」を実行し、アクセスできないものを除外し、かつレイテンシーが低い順でソートを行います。

低レイテンシー順位トップ `n` 個のノードからランダムピックアップを行い、接続ノードを決定します。
尚 `n` はアプリケーションが任意に指定可能です。 

## 2. サンプル実行手順（Node.js向け）

### 2.1. リポジトリをクローンしてビルド

```shell
git clone https://github.com/OPENSPHERE-Inc/node-tracker-poc.git
cd node-tracker-poc
yarn
yarn build
```

### 2.2. `dot.env` ファイルを `.env` にリネームして編集

**テストネットの場合**

```dotenv
STATS_SERVICE_URL=https://testnet.symbol.services/nodes
NETWORK_TYPE=152
```

**メインネットの場合**

```dotenv
STATS_SERVICE_URL=https://symbol.services/nodes
NETWORK_TYPE=104
```

### 2.3. 実行

**・ランダムピック1件サンプル**

```shell
node dist/samples/randomPick.js
```

`randomPick` サンプルでは、低レイテンシー上位10個から一つノードをランダムピックして転送トランザクションを実行します。
送信元のプライベートキーと送信先のアドレス、転送量（XYM）をそれぞれ聞かれるので入力してください。

**・任意選択サンプル**

```shell
node dist/samples/userPick.js
```

`userPick` サンプルでは、ユーザーがノードリストから選択して転送トランザクションを実行します。
ノードリストは低レイテンシー上位10個になります。
ランダムピックと同様に送信元プライベートキー、送信先アドレス、転送量（XYM）の入力を求められます。

## 3. ブラウザ向けサンプル

[こちら](./browser-sample) にサンプルを用意しました。

## 4. ライブラリリファレンス (TypeScript/JavaScript)

### 4.1. [NodeTrackerService](./src/services/node_tracker.ts) クラス

**サンプルコード**

```typescript
const nodeTracker = new NodeTrackerService("https://testnet.symbol.services/nodes", 152);
await nodeTracker.discovery();
await nodeTracker.pingAll();

// 低レイテンシートップ 10 以内かつレイテンシー 1000 msec 以下の物からピック
let node = nodeTracker.pickOne(10, 1000);

// ピック済みノードのヘルスチェックを行い、不良であれば新しいノードをピック
while (!await nodeTracker.checkHealth(node.apiStatus.restGatewayUrl)) {
   node = await nodeTracker.pickOne(10, 1000); 
}

// 健康なノードを 5 個ピック
const healthyNodes = nodeTracker.pickMulti(5, 10, 1000);
```

#### _コンストラクタ_

```typescript
const options: NodeTrackerServiceOptions = {
    cachedNodes: [] as NodeStatistics,
};

const nodeTracker = new NodeTrackerService(statsServiceURL, networkType, options);
```

**引数**

- `statsServiceURL: string` -　Symbol Statistics Service の URL。Testnet: `https://testnet.symbol.services/nodes`, Mainnet: `https://symbol.services/nodes`
- `networkType: NetworkType` - Testnet: `152`, Mainnet: `104`
- `option: NodeTrackerServiceOptions`
  - `cachedNodes: NodeStatistics[]` - `availableNodes` をローカルキャッシュしていた場合はここで渡す
  - `noWebSocketChallenge: boolean` - WebSocket 接続のチェックを行わない（その分高速）。デフォルトは `false`
  - `webSocketTimeout: number` - WebSocket 接続のタイムアウト時間をミリ秒で指定。デフォルトは `60` 秒
  - `maxParallels: number` - ヘルスチェックの同時実行数。デフォルトは `10`。
    値を大きくするとヘルスチェックがスピードアップしますが、やりすぎると接続エラーが頻発する場合があります。
    試した限りだと `50` 位が限度かもしれません。

#### _discovery メソッド_

```typescript
const avaiableNodes: NodeStatistics[] = await nodeTracker.discovery();
```

Symbol Statistics Service からノードリストを取得します。
有効でないノード（API status が有効でない物、https が有効でない物、WebSocket が有効でない物）は除外されます。

**戻り値**

- `NodeStatistics[]` - ノードリスト

#### _pingAll メソッド_

```typescript
const availableNodes: NodeStatistics[] = await nodeTracker.pingAll();
```

有効なノード全てにヘルスチェックを実行します。
ヘルスチェックでは、REST API でデータにアクセスを試みて掛かる時間をミリ秒単位で計測します。
また、WebSocket の接続を試みます。

全ノードのヘルスチェックが完了すると Promise が Resolve されます。

途中経過は `pingObserver` プロパティを購読してください。

**戻り値**

- `NodeStatistics[]` - ノードリスト

#### _abortPinging メソッド_

```typescript
nodeTracker.abortPinging();
```

`pingAll` の実行を中止します。
実行して程なく `pingAll` メソッドが途中終了して戻ります（その際、WebSocket が全てクローズされるのを待ちます）

既に開始しているノードは WebSocket は強制的にクローズされ、中止させられます。
この時、`NodeStatsitics` の `latency` プロパティは `undefined` になり、
`last_error` プロパティには `WebSocket connection interrupted.` エラーが格納されます。

未だ開始していないノードは、それ以上実行されず `latency` も `last_error` もどちらも変化なしです。

#### _pickOne メソッド_

```typescript
const node: NodeStatistics | undefined = await nodeTracker.pickOne(top, maxLatency);
```

ノードリストからノードを1件ランダムピックします。

**引数**

- `top: number` - (Optional) 低レイテンシートップ何位以内からランダムピックするかを指定できます。
  1 なら常に最もレイテンシーが低いノードがピックされます。省略した場合はリスト全体からのランダムピックとなります。
- `maxLatency: number` - (Optional) 許容する最大レイテンシーをミリ秒単位で指定できます。省略した場合は制限なしとなります。

**戻り値**

- `NodeStatistics | undefined` - ピックされたノード

#### _pickMulti メソッド_

```typescript
const nodes: NodeStatistics[] = await nodeTracker.pickMulti(count, top, maxLatency);
```

ノードリストからノードを複数件ランダムピックします。

**引数**

- `count: number` - ピック数。有効なノードが足りない場合、要求を下回る場合があります。
- `top: number` - (Optional) 低レイテンシートップ何位以内からランダムピックするかを指定できます。
  1 なら常に最もレイテンシーが低いノードがピックされます。省略した場合はリスト全体からのランダムピックとなります。
- `maxLatency: number` - (Optional) 許容する最大レイテンシーをミリ秒単位で指定できます。省略した場合は制限なしとなります。

**戻り値**

- `NodeStatistics[]` - ピックされたノードリスト（ソートされてません）

#### _checkHealth メソッド_

```typescript
const healthyNode: NodeStatistics | undefined = await nodeTracker.checkHealth(nodeUrl);
```

ノードURLで指定したノードのヘルスチェックを実施します。

**引数**

- `nodeUrl: string` - ノードの REST Gateway URL

**戻り値**

- `NodeStatistics | undefined` - ヘルスが良好な場合は値が返り、不良の場合は `undefined` が返ります。


#### _availableNodes プロパティ (Readonly)_

```typescript
const nodes: NodeStatistics = nodeTracker.availableNodes;
```

Symbol Statistics Service から取得したノードリストにアクセス出来ます。

負荷集中を避けるために、ノードリストはローカルキャッシュすることを推奨します。

ローカルキャッシュを `NodeTrackerService` のコンストラクタに渡すことで `disvoery()` の呼び出しを省略することが可能です。

#### _pingObserver プロパティ (Readonly)_

```typescript
const observer: Subject<NodeStatistics> = nodeTracker.pingObserver;
```

ヘルスチェックの進捗を購読できる `Subject` (rxjs) です。

**使用例**

```typescript
const subscription = observer.subscribe((node: NodeStatistics) => {
    if (node.latest_error) {
        console.debug(`${node.apiStatus.restGatewayUrl} [${node.latest_error}]`);
    } else {
        console.debug(`${node.apiStatus.restGatewayUrl} [${node.latency} msecs]`);
    }
});

// ...中略...

subscription.unsubscribe();
```

ヘルスチェックが完了した `NodeStatistics` がリアルタイムにプッシュされます。
リスト UI の更新トリガーなどに使用可能です。

#### _isAborting プロパティ (Readonly)_

```typescript
const abortingCondition: boolean = nodeTracker.isAborting;
```

初期値は `false` で、`abortPinging` が呼ばれると `true` になります。
`pingAll` が呼ばれると `false` となります。

#### _numActiveWebSockets プロパティ（Readonly)_

```typescript
const count: number = nodeTracker.numActiveWebSockets;
```

今現在アクティブな WebSocket の数を返します。
`pingAll` メソッドが終了した後は `0` になります。

### 4.2. [NodeStatistics](./src/services/node_tracker.ts) インターフェース

```typescript
interface NodeStatistics {
    peerStatus: {
        isAvailable: boolean;
        lastStatusCheck: number;
    };
    apiStatus: {
        restGatewayUrl: string;
        isAvailable: boolean;
        lastStatusCheck: number;
        nodeStatus: {
            apiNode: string;
            db: string;
        };
        isHttpsEnabled: boolean;
        finalization: {
            height: number;
            epoch: number;
            point: number;
            hash: string;
        };
        restVersion: string;
        webSocket: {
            isAvailable: boolean;
            wss: boolean;
            url: string;
        };
    };
    version: string;
    publicKey: string;
    networkGenerationHashSeed: string;
    roles: number;
    port: number;
    networkIdentifier: number;
    host: string;
    friendlyName: string;

    // Filled by NodeTrackerService
    latency?: number;
    latest_error?: string;
}
```

詳細は [Open API](https://symbol.services/openapi/index.html#tag/node/operation/getNodes) の `Responses` を参照してください。

**主要なフィールド**

- `networkIdentifier: number` - `NetworkType` が格納されます（Testnet: `152`, Mainnet: `104`）
- `apiStatus.isAvaiable: boolean` - ノードの有効性が格納されます
- `apiStatus.restGatewayUrl: string` - REST Gateway URL が格納されます
- `apiStatus.nodeStatus.apiNode: string` - API ノードの状態が `up`（稼働中）または `down`（障害発生）で格納されます
- `apiStatus.nodeStatus.db: string` - MongoDB の状態が `up`（稼働中）または `down`（障害発生）で格納されます
- `apiStatus.isHttpsEnabled: boolean` - HTTPS の有無が格納されます
- `apiStatus.webSocket.isAvailable: boolean` - WebSocket の有無が格納されます
- `apiStatus.webSocket.wss: boolean` - WebSocket over SSL/TLS の有無が格納されます
- `apiStatus.webSocket.url: string` - WebSocket URL が格納されます

以下の二つのフィールドは `NodeTrackerService` のヘルスチェックによって追加されます。

- `latest_error: string | undefined` - ヘルス不良のノードはエラーメッセージが格納されます。良好であれば `undefined` になります。
- `latency: number | undefined` - ヘルスが良好な場合、レイテンシーの値（ミリ秒）が格納されます。

## 5. 本ライブラリの今後について

本ライブラリは他プロジェクトで使用する為、
近日中に [@opensphere-inc/symbol-service](https://www.npmjs.com/package/@opensphere-inc/symbol-service) へ統合される予定です。

---

本ライブラリに関しての質問等ありましたら Discussion へ、不具合等は Issue へお寄せいただければと思います。

本リポジトリは MIT ライセンスといたします。
