# GitHub + Vercel デプロイ手順

## ① GitHubにリポジトリを作成してプッシュ

### 1-1. GitHubで新しいリポジトリを作成
1. https://github.com/new を開く
2. Repository name: `baseball-app`
3. Public / Private どちらでもOK
4. **「Initialize this repository」のチェックは外す**
5. 「Create repository」をクリック

### 1-2. このフォルダをGitHubへプッシュ

ターミナル（Mac: Terminal / Windows: PowerShell）でこのフォルダに移動して以下を実行：

```bash
cd このフォルダのパス   # 例: cd ~/Downloads/baseball-deploy

git init
git add .
git commit -m "Initial commit: 野球スコアブック"
git branch -M main
git remote add origin https://github.com/あなたのユーザー名/baseball-app.git
git push -u origin main
```

> ※ `あなたのユーザー名` は GitHub のユーザー名に置き換えてください

---

## ② VercelでデプロイしてURLを取得

### 2-1. Vercelにログイン
1. https://vercel.com にアクセス
2. 「Continue with GitHub」でGitHubアカウントでログイン

### 2-2. プロジェクトをインポート
1. ダッシュボードの「Add New → Project」をクリック
2. `baseball-app` リポジトリを選択して「Import」
3. 設定はそのまま（Viteが自動検出されます）
4. 「Deploy」をクリック

### 2-3. 完了！
- 約1〜2分でデプロイ完了
- `https://baseball-app-xxxx.vercel.app` のようなURLが発行されます
- スマホでそのURLを開けばすぐに使えます！

---

## ③ 以降の更新方法

ファイルを修正したら以下を実行するだけで自動的に再デプロイされます：

```bash
git add .
git commit -m "更新内容のメモ"
git push
```
