'use client'

import React, { useState } from 'react'
import Link from 'next/link'

interface Section {
  id: string
  title: string
  icon: string
}

const SECTIONS: Section[] = [
  { id: 'flow', title: '全体の流れ（3分で理解）', icon: '⚡' },
  { id: 'start', title: 'ログイン・会社管理・招待', icon: '🏢' },
  { id: 'learning', title: '【重要】過去帳簿の学習設定', icon: '📚' },
  { id: 'modes', title: '仕訳作成（3つのモード）', icon: '📑' },
  { id: 'table', title: '仕訳結果の確認・編集・全幅表示', icon: '✏️' },
  { id: 'export', title: '弥生会計CSV・Excelの出力', icon: '💾' },
  { id: 'history', title: '解析履歴の確認・復元', icon: '📜' },
  { id: 'faq', title: 'よくある質問 (FAQ)', icon: '❓' },
]

export default function ManualPage() {
  const [activeSection, setActiveSection] = useState<string>('flow')

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      {/* 固定ヘッダー */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              ← 仕訳作成に戻る
            </Link>
            <div className="h-4 w-px bg-slate-200" />
            <div className="flex items-center gap-2">
              <span className="text-xl">📖</span>
              <h1 className="text-base font-extrabold text-slate-900">
                使い方マニュアル（ユーザーガイド）
              </h1>
            </div>
          </div>
          <span className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 px-2.5 py-1 rounded-full font-bold">
            弥生会計26完全対応
          </span>
        </div>
      </header>

      {/* メインレイアウト */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
          {/* 左側：目次ナビゲーション（sticky） */}
          <aside className="md:col-span-4 lg:col-span-3 sticky top-20 space-y-1 bg-white p-3 rounded-2xl border border-slate-200 shadow-xs">
            <div className="px-3 py-2 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              目次
            </div>
            {SECTIONS.map((sec) => {
              const isCur = activeSection === sec.id
              return (
                <button
                  key={sec.id}
                  onClick={() => {
                    setActiveSection(sec.id)
                    const el = document.getElementById(sec.id)
                    if (el) {
                      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-bold rounded-xl transition-all text-left cursor-pointer ${
                    isCur
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <span className="text-base">{sec.icon}</span>
                  <span className="truncate">{sec.title}</span>
                </button>
              )
            })}
          </aside>

          {/* 右側：マニュアル本文 */}
          <main className="md:col-span-8 lg:col-span-9 space-y-8">
            {/* 1. 全体の流れ */}
            <section id="flow" className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4 scroll-mt-20">
              <div className="flex items-center gap-2 text-indigo-600">
                <span className="text-2xl">⚡</span>
                <h2 className="text-lg font-extrabold text-slate-900">1. 全体の流れ（3分で理解）</h2>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                本アプリは、紙やPDFの領収書・通帳・独自帳票をアップロードするだけで、AI（Gemini）が自動で仕訳を作成し、弥生会計用CSVやExcelとして出力できるクラウドサービスです。
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 pt-2">
                {[
                  { step: 'Step 1', title: '会社を選択', desc: '作業スペースを選択' },
                  { step: 'Step 2', title: '過去帳簿を学習', desc: '前期の帳簿を登録(初回推奨)' },
                  { step: 'Step 3', title: '資料アップロード', desc: '領収書や通帳をドロップ' },
                  { step: 'Step 4', title: '仕訳を確認・編集', desc: '画面上で確認・直接修正' },
                  { step: 'Step 5', title: '出力', desc: '弥生CSV / Excelで保存' },
                ].map((s, idx) => (
                  <div key={idx} className="p-3 bg-slate-50 border border-slate-100 rounded-xl text-center space-y-1">
                    <span className="text-[10px] font-extrabold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200 block w-fit mx-auto">
                      {s.step}
                    </span>
                    <div className="text-xs font-bold text-slate-800">{s.title}</div>
                    <div className="text-[10px] text-slate-500">{s.desc}</div>
                  </div>
                ))}
              </div>
            </section>

            {/* 2. ログイン・会社管理・招待 */}
            <section id="start" className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4 scroll-mt-20">
              <div className="flex items-center gap-2 text-indigo-600">
                <span className="text-2xl">🏢</span>
                <h2 className="text-lg font-extrabold text-slate-900">2. ログイン・会社管理・招待</h2>
              </div>

              <div className="space-y-3 text-xs text-slate-600 leading-relaxed">
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                  <h3 className="font-bold text-slate-800 flex items-center gap-1.5">
                    <span>👥 複数会社（マルチテナント）対応</span>
                  </h3>
                  <p>
                    1つのアカウントで複数の会社（クライアント）を管理できます。会社ごとに仕訳データや過去帳簿、解析履歴が完全に独立して保持されます。
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-slate-700 pl-1">
                    <li><strong>会社を切り替える:</strong> 画面右上の会社名をクリックしてドロップダウンから選択します。</li>
                    <li><strong>新しい会社を作成する:</strong> ドロップダウン下部の「＋ 新しい会社を作成」から会社名を登録します（作成者がOwnerになります）。</li>
                  </ul>
                </div>

                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                  <h3 className="font-bold text-slate-800 flex items-center gap-1.5">
                    <span>✉️ チームメンバーの招待</span>
                  </h3>
                  <p>
                    社内の他のメンバーや担当者を招待して、同じ会社の仕訳データや解析履歴をリアルタイム共有できます。
                  </p>
                  <ol className="list-decimal list-inside space-y-1 text-slate-700 pl-1">
                    <li>画面右上の会社メニューを開き、「👥 メンバー管理・招待」をクリック。</li>
                    <li>招待したいメンバーのメールアドレスと権限（管理者またはメンバー）を入力して送信。</li>
                    <li>届いた招待メールのリンクを開くことで、同じ会社スペースに参加できます。</li>
                  </ol>
                </div>
              </div>
            </section>

            {/* 3. 過去帳簿の学習設定 */}
            <section id="learning" className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4 scroll-mt-20">
              <div className="flex items-center gap-2 text-indigo-600">
                <span className="text-2xl">📚</span>
                <h2 className="text-lg font-extrabold text-slate-900">3. 【精度UPの秘訣】過去帳簿の学習設定</h2>
              </div>
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 font-medium">
                💡 <strong>仕訳精度を大幅に高めるための最重要機能です！</strong><br />
                前期・前々期の帳簿をアップロードしておくと、AIが「御社特有の取引先・摘要と勘定科目・補助科目の対応ルール」を自動学習し、最優先で適用します。
              </div>

              <div className="space-y-3 text-xs text-slate-600 leading-relaxed">
                <p>
                  画面上部の <strong>「📚 過去帳簿・仕訳学習」</strong> ボタンからいつでも設定できます。
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3 border border-slate-200 rounded-xl bg-slate-50 space-y-1">
                    <div className="font-bold text-slate-800">📑 仕訳日記帳（推奨）</div>
                    <p className="text-[11px] text-slate-500">
                      過去の日々の仕訳。取引先や摘要と科目の対応ルールを最も詳細に学習します。
                    </p>
                  </div>
                  <div className="p-3 border border-slate-200 rounded-xl bg-slate-50 space-y-1">
                    <div className="font-bold text-slate-800">📖 総勘定元帳</div>
                    <p className="text-[11px] text-slate-500">
                      科目ごとの取引明細。どの相手先にどの科目を使っていたかを学習します。
                    </p>
                  </div>
                  <div className="p-3 border border-slate-200 rounded-xl bg-slate-50 space-y-1">
                    <div className="font-bold text-slate-800">📊 補助残高一覧表</div>
                    <p className="text-[11px] text-slate-500">
                      取引先別の補助科目一覧。取引先名や銀行口座の補助科目対応に反映されます。
                    </p>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-600 space-y-1">
                  <strong>対応フォーマット:</strong> 会計ソフトから出力した CSV, Excel (.xlsx), TSV 等<br />
                  ※ 日本の会計ソフト標準の <strong>Shift_JIS (CP932) も自動判別</strong> して文字化けゼロで読み込みます。
                </div>
              </div>
            </section>

            {/* 4. 仕訳作成（3つのモード） */}
            <section id="modes" className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4 scroll-mt-20">
              <div className="flex items-center gap-2 text-indigo-600">
                <span className="text-2xl">📑</span>
                <h2 className="text-lg font-extrabold text-slate-900">4. 仕訳を作成する（3つのモード）</h2>
              </div>

              <div className="space-y-4">
                {/* 領収書モード */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2 text-xs">
                  <div className="font-bold text-slate-900 flex items-center gap-2">
                    <span className="text-base">📄</span>
                    <span>1. 領収書モード（レシート・請求書）</span>
                  </div>
                  <p className="text-slate-600">
                    レシートや領収書、請求書の画像（JPG, PNG, WebP）またはPDFをアップロードします。
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-slate-700">
                    <li>取引日、支払先・店舗名、品目、金額、税区分を精密に読み取ります。</li>
                    <li><strong>複数税率の自動分割:</strong> 1枚の中に「10%対象」と「8%軽減税率対象」が混ざっている場合、<strong>自動で2行の仕訳に分割</strong>して起票します。</li>
                  </ul>
                </div>

                {/* 通帳モード */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2 text-xs">
                  <div className="font-bold text-slate-900 flex items-center gap-2">
                    <span className="text-base">🏦</span>
                    <span>2. 通帳モード（預金通帳・複数ページPDF）</span>
                  </div>
                  <p className="text-slate-600">
                    銀行通帳の画像またはスキャンした複数ページのPDFをアップロードします。
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-slate-700">
                    <li><strong>複数ページ一括解析:</strong> 10ページや20ページの通帳PDFでも、全ページを順番に1明細も漏らさず解析します。</li>
                    <li><strong>実科目の自動判定:</strong> 「仮払金」「仮受金」を一律に付けず、過去帳簿の実績や標準辞書（電力ガス➔水道光熱費、NTT➔通信費、振込手数料➔支払手数料、カード引落➔未払金、売上入金➔売掛金など）から適切な科目を自動判定します。</li>
                    <li>相手先会社名やカード会社名が<strong>「借方補助」「貸方補助」</strong>に自動設定されます。</li>
                  </ul>
                </div>

                {/* 会社専用カスタムモード */}
                <div className="p-4 rounded-xl border border-purple-200 bg-purple-50/50 space-y-2 text-xs">
                  <div className="font-bold text-purple-950 flex items-center gap-2">
                    <span className="text-base">📋</span>
                    <span>3. 会社専用カスタムモード（独自帳票・日計表等）</span>
                  </div>
                  <p className="text-purple-900">
                    POSレジ日計表、独自フォーマット納品書、特定EC明細など、会社特有の資料に合わせて<strong>あなた自身がAIへの指示文（プロンプト）を自由に設定</strong>できる機能です。
                  </p>
                  <div className="bg-white p-3 rounded-lg border border-purple-200 space-y-1 text-[11px] text-purple-950">
                    <strong>設定手順:</strong>
                    <ol className="list-decimal list-inside space-y-0.5 pl-1">
                      <li>モードタブ右端の「➕ 専用モード追加」をクリック。</li>
                      <li>雛形テンプレート（POSレジ日計表、独自納品書など）から選ぶか、独自の仕訳ルールを入力して保存。</li>
                      <li>新設されたタブ（例: 📊 POSレジ日計表）を選んで資料をアップロードすれば、その指示通りに仕訳が作成されます。</li>
                    </ol>
                  </div>
                </div>
              </div>
            </section>

            {/* 5. 仕訳結果の確認と編集 */}
            <section id="table" className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4 scroll-mt-20">
              <div className="flex items-center gap-2 text-indigo-600">
                <span className="text-2xl">✏️</span>
                <h2 className="text-lg font-extrabold text-slate-900">5. 仕訳結果の確認・編集・全幅表示</h2>
              </div>

              <div className="space-y-3 text-xs text-slate-600 leading-relaxed">
                <p>
                  AI解析が完了すると、左側に<strong>元資料プレビュー</strong>、右側に<strong>スプレッドシート型仕訳一覧テーブル</strong>が表示されます。
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                    <div className="font-bold text-slate-900">⤢ 全幅表示 (プレビューを隠す)</div>
                    <p className="text-[11px] text-slate-500">
                      テーブル上部のボタンを押すと、左プレビューを折りたたんで画面横幅100%ですべての欄を快適に確認・編集できます。
                    </p>
                  </div>
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                    <div className="font-bold text-slate-900">⚠️ 要確認項目のハイライト</div>
                    <p className="text-[11px] text-slate-500">
                      AIが読み取りに自信が持てなかったセルは黄色背景で強調されます。内容を確認し、直接修正してください。
                    </p>
                  </div>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <div className="font-bold text-slate-800">効率的な編集テクニック:</div>
                  <ul className="list-disc list-inside space-y-1 text-slate-700 pl-1">
                    <li><strong>直接編集:</strong> すべての入力欄（科目・補助・税区分・金額・摘要）は直接キー入力で打ち替え可能です。</li>
                    <li><strong>一括変更:</strong> 行の左端のチェックボックス（☑）で複数仕訳を選択し、テーブル上部の「科目一括変更」「税区分一括変更」からまとめて変更できます。</li>
                    <li><strong>行削除:</strong> 右端のゴミ箱アイコンから、不要な行を1件ずつ削除できます。</li>
                  </ul>
                </div>
              </div>
            </section>

            {/* 6. 弥生会計CSV・Excelの出力 */}
            <section id="export" className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4 scroll-mt-20">
              <div className="flex items-center gap-2 text-indigo-600">
                <span className="text-2xl">💾</span>
                <h2 className="text-lg font-extrabold text-slate-900">6. 弥生会計CSV・Excelの出力</h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="p-4 bg-blue-50/60 border border-blue-200 rounded-xl space-y-2">
                  <h3 className="font-bold text-blue-900 flex items-center gap-1.5">
                    <span>📄 弥生会計用CSVダウンロード</span>
                  </h3>
                  <p className="text-blue-950">
                    弥生会計26のインポート仕様（25項目・単行仕訳形式、Shift_JIS / CP932）に完全準拠したCSVファイルを出力します。
                  </p>
                  <div className="text-[11px] text-blue-800 font-mono bg-white p-2.5 rounded border border-blue-200">
                    弥生会計 ➔ [帳簿・伝票] ➔ [仕訳日記帳] ➔ [ファイル] ➔ [インポート] でそのまま取り込めます。
                  </div>
                </div>

                <div className="p-4 bg-emerald-50/60 border border-emerald-200 rounded-xl space-y-2">
                  <h3 className="font-bold text-emerald-900 flex items-center gap-1.5">
                    <span>📊 Excel (.xlsx) ダウンロード</span>
                  </h3>
                  <p className="text-emerald-950">
                    プロフェッショナルな2シート構成のExcelファイルを出力します。
                  </p>
                  <ul className="list-disc list-inside text-[11px] text-emerald-800 space-y-1">
                    <li><strong>シート1「仕訳明細一覧」:</strong> 補助科目や元ファイル名を含む明細一覧。</li>
                    <li><strong>シート2「勘定科目別集計」:</strong> 借方・貸方の科目別合計金額サマリー。</li>
                  </ul>
                </div>
              </div>
            </section>

            {/* 7. 解析履歴の確認・復元 */}
            <section id="history" className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4 scroll-mt-20">
              <div className="flex items-center gap-2 text-indigo-600">
                <span className="text-2xl">📜</span>
                <h2 className="text-lg font-extrabold text-slate-900">7. 解析履歴の確認・復元</h2>
              </div>

              <div className="space-y-3 text-xs text-slate-600 leading-relaxed">
                <p>
                  ヘッダー右側の <strong>「📜 解析履歴」</strong> ボタンから、いつでも過去に解析した仕訳履歴を確認できます。
                </p>
                <ul className="list-disc list-inside space-y-1 text-slate-700 pl-1">
                  <li><strong>クラウド共有:</strong> クラウドデータベース（Supabase）に保存されるため、どのパソコンからログインしても同じ履歴が見られます。</li>
                  <li><strong>仕訳の復元:</strong> 「仕訳を復元」ボタンを押すと、過去の解析結果が画面上に呼び戻され、再編集や再ダウンロードが可能です。</li>
                </ul>
              </div>
            </section>

            {/* 8. よくある質問 (FAQ) */}
            <section id="faq" className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4 scroll-mt-20">
              <div className="flex items-center gap-2 text-indigo-600">
                <span className="text-2xl">❓</span>
                <h2 className="text-lg font-extrabold text-slate-900">8. よくある質問 (FAQ)</h2>
              </div>

              <div className="space-y-3 text-xs">
                {[
                  {
                    q: 'Q. 会計ソフトのエクスポートCSVが文字化けしませんか？',
                    a: '本アプリはShift_JIS (CP932) とUTF-8を自動判別してデコードするため、文字化けせず正常に学習されます。Excelファイル (.xlsx) の直接アップロードも可能です。',
                  },
                  {
                    q: 'Q. 1枚のレシートに10%と8%軽減税率が混ざっている場合は？',
                    a: 'AIが税率ごとの小計を自動判別し、10%対象分と8%対象分の2行の仕訳に自動で分割作成します。',
                  },
                  {
                    q: 'Q. 作成した専用モードやプロンプトは他のメンバーも使えますか？',
                    a: 'はい。専用モードは会社単位でクラウドに保存されるため、同じ会社に所属する全メンバーが同じ専用モード・プロンプトを利用できます。',
                  },
                  {
                    q: 'Q. 会社を切り替えたら、仕訳データが混ざりませんか？',
                    a: '混ざりません。会社ごとに作業スペースが完全に独立しており、会社を切り替えると仕訳データ、過去帳簿、専用モードすべてがその会社専用のものに切り替わります。',
                  },
                ].map((item, idx) => (
                  <div key={idx} className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                    <div className="font-bold text-slate-900">{item.q}</div>
                    <div className="text-slate-600 leading-relaxed">{item.a}</div>
                  </div>
                ))}
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
  )
}
