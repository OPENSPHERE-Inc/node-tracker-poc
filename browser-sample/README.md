# Node Tracker for Symbol PoC SDK Browser (React) 向けサンプルコード

## 1. ビルド

`dot.env` を `.env` にリネームし、内容を編集してください。

**テストネットの場合**

```dotenv
SKIP_PREFLIGHT_CHECK=true
REACT_APP_STATS_SERVICE_URL=https://testnet.symbol.services/nodes
REACT_APP_NETWORK_TYPE=152
```

**メインネットの場合**

```dotenv
SKIP_PREFLIGHT_CHECK=true
REACT_APP_STATS_SERVICE_URL=https://symbol.services/nodes
REACT_APP_NETWORK_TYPE=104
```

次に、親ディレクトリの node-tracker-poc パッケージをビルドしてください。

```shell
cd ..
yarn 
yarn build
```

その後に、ビルドを実行してください。

```shell
cd browser-sample
yarn
yarn build
```

## 2. 実行

`react-scripts` を使うと開発用 Web サーバーを起動できます。
以下のように起動してください。

```shell
yarn start
```

ブラウザーで `http://localhost:3000` を開いてください（上記コマンドで勝手にブラウザーが開きます）

`Open Node Tracker` ボタンをクリックすると、ノードリストが表示されます。
使用したいノードをクリックすることで選択します。

ノードが選択されれると転送フォームが表示されますので、プライベートキーと転送先アドレス、転送量(XYM)、
メッセージをそれぞれ入力して `Execute` ボタンをクリックしてください。

選択したノードでトランザクションがアナウンスされます。

`Transaction succeeded` と表示されれば成功です。
