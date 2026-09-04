# References working list

제출 조립 원문 [`final-source.md`](final-source.md)의 인용은 2026-09-05에 원문 버전과 직접 대조했다.
이번 확인 범위는 [`claim-to-citation.md`](claim-to-citation.md) G절에 기록한다. 아래 목록은 더 넓은
역사적 후보 목록이며, 모든 후보가 최종 원고에 사용되거나 이번에 다시 확인된 것은 아니다.

- 기준일: 2026-08-17 KST
- 목적: 제출 원고의 인용 후보와 사용 위치를 고정한다. 최종 서지 형식은 Notion 원고 단계에서 통일한다.
- 원칙: arXiv version이 바뀌면 인용 수치와 limitation을 다시 확인한다.

## Competition and MetaMask primary sources

### COMP-01 — FP Research Challenge 2026 참가 신청 안내

- Source: Four Pillars public Notion
- URL: https://app.notion.com/p/4pillars/FP-Research-Challenge-2026-3a61115e1d9080688a2cd0f54983ba1c
- Checked: 2026-08-17 KST
- Use: track scope, anonymity, format, submission process, conflicting schedule

### COMP-02 — Four Pillars Research Challenge 2026 공식 블로그

- Source: Four Pillars, published 2026-07-28
- URL: https://4pillars.io/ko/blog/four-pillars-to-host-four-pillars-research-challenge-2026-for-university-blockchain-clubs-across-south-korea
- Checked: 2026-08-17 KST
- Use: September 6 deadline and MetaMask track scope

### MM-01 — Agent Wallet architecture

- Source: MetaMask developer documentation
- URL: https://docs.metamask.io/agent-wallet/reference/architecture/
- Checked: 2026-08-17 KST
- Use: server wallet, SDK/CLI, simulation, scanning, batch/sequential execution

### MM-02 — Trading modes

- Source: MetaMask developer documentation
- URL: https://docs.metamask.io/agent-wallet/reference/trading-modes/
- Checked: 2026-08-17 KST
- Use: Guard Mode allowlists, rolling outflow and 2FA boundary

### MM-03 — Outflow policy

- Source: MetaMask developer documentation
- URL: https://docs.metamask.io/agent-wallet/reference/outflow-policy/
- Checked: 2026-08-17 KST
- Use: rolling 24-hour accounting, simulation, covered operations and documented limitations

## Agent security benchmarks

### BENCH-01 — AgentDojo

- Edoardo Debenedetti, Jie Zhang, Mislav Balunović, Luca Beurer-Kellner, Marc Fischer, Florian Tramèr.
- _AgentDojo: A Dynamic Environment to Evaluate Prompt Injection Attacks and Defenses for LLM Agents._ NeurIPS 2024 Datasets and Benchmarks. arXiv v3, 2024.
- URL: https://arxiv.org/abs/2406.13352
- Use: representative stateful benchmark; 97 tasks and 629 security cases; evidence against a `single-step only` claim

### BENCH-02 — Agent Security Bench

- Hanrong Zhang, Jingyuan Huang, Kai Mei, Yifei Yao, Zhenting Wang, Chenlu Zhan, Hongwei Wang, Yongfeng Zhang.
- _Agent Security Bench (ASB): Formalizing and Benchmarking Attacks and Defenses in LLM-based Agents._ ICLR 2025. arXiv v4, 2025.
- URL: https://arxiv.org/abs/2410.02644
- Use: broad attack/defense taxonomy and security–utility evaluation

### BENCH-03 — AgentDyn

- Hao Li, Ruoyao Wen, Shanghao Shi, Ning Zhang, Yevgeniy Vorobeychik, Chaowei Xiao.
- _AgentDyn: Are Your Agent Security Defenses Deployable in Real-World Dynamic Environments?_ arXiv v3, 2026.
- URL: https://arxiv.org/abs/2602.03117
- Use: dynamic open-ended tasks, helpful third-party instructions, over-defense

## Direct defenses

### DEF-01 — Task Shield

- Feiran Jia, Tong Wu, Xin Qin, Anna Squicciarini.
- _The Task Shield: Enforcing Task Alignment to Defend Against Indirect Prompt Injection in LLM Agents._ ACL 2025. arXiv v1, 2024.
- URLs: https://arxiv.org/abs/2412.16682 · https://aclanthology.org/2025.acl-long.1435/
- Use: action-to-goal contribution baseline

### DEF-02 — DRIFT

- Hao Li, Xiaogeng Liu, Hung-Chun Chiu, Dianqi Li, Ning Zhang, Chaowei Xiao.
- _DRIFT: Dynamic Rule-Based Defense with Injection Isolation for Securing LLM Agents._ NeurIPS 2025. arXiv v3, 2026.
- URL: https://arxiv.org/abs/2506.12104
- Use: plan trajectory, parameter checklist and injection isolation baseline

### DEF-03 — Progent

- Tianneng Shi, Jingxuan He, Zhun Wang, Hongwei Li, Linyu Wu, Wenbo Guo, Dawn Song.
- _Progent: Securing AI Agents with Privilege Control._ arXiv v3, 2026.
- URL: https://arxiv.org/abs/2504.11703
- Use: deterministic symbolic tool-argument policy and monotonic confinement baseline

### DEF-04 — AgentSpec

- Haoyu Wang, Christopher M. Poskitt, Jun Sun.
- _AgentSpec: Customizable Runtime Enforcement for Safe and Reliable LLM Agents._ ICSE 2026. arXiv v3, 2025.
- URL: https://arxiv.org/abs/2503.18666
- Use: generic runtime rule DSL and stateless checkpoint baseline

### DEF-05 — CaMeL

- Edoardo Debenedetti et al.
- _Defeating Prompt Injections by Design._ arXiv v2, 2025.
- URL: https://arxiv.org/abs/2503.18813
- Use: trusted control/data flow, capability and conditional provable security boundary; AgentDojo task completion 77% with provable security versus 84% for the undefended system

### DEF-06 — AgentArmor

- Peiran Wang et al.
- _AgentArmor: Enforcing Program Analysis on Agent Runtime Trace to Defend Against Prompt Injection._ arXiv v3, 2025.
- URL: https://arxiv.org/abs/2508.01249
- Use: runtime trace as structured program, CFG/DFG/PDG and type-system baseline

### DEF-07 — ScopeGate

- David Mellafe Zuvic.
- _Capability Gates Are Not Authorization: Confused-Deputy Failures in LLM Agent Frameworks._ arXiv v1, 2026.
- URL: https://arxiv.org/abs/2606.28679
- Use: fail-closed concrete-argument value authorization, money ceiling and idempotency

## Formal monitoring

### FORMAL-01 — Formal Methods Meet LLMs

- Parand A. Alamdari, Toryn Q. Klassen, Sheila A. McIlraith.
- _Formal Methods Meet LLMs: Auditing, Monitoring, and Intervention for Compliance of Advanced AI Systems._ arXiv v1, 2026.
- URL: https://arxiv.org/abs/2605.16198
- Use: LTL runtime monitoring, temporally extended constraints, labeler/specification boundary

## Web3 agent security

### WEB3-01 — Real AI Agents with Fake Memories

- Atharv Singh Patlan, Peiyao Sheng, S. Ashwin Hebbar, Prateek Mittal, Pramod Viswanath.
- _Real AI Agents with Fake Memories: Fatal Context Manipulation Attacks on Web3 Agents._ arXiv v3, 2025.
- URL: https://arxiv.org/abs/2503.16248
- Use: Web3 context manipulation, unauthorized transfer, memory persistence and CrAIBench

### WEB3-02 — AI Agents in Cryptoland

- Atharv Singh Patlan, Peiyao Sheng, S. Ashwin Hebbar, Prateek Mittal, Pramod Viswanath.
- _AI Agents in Cryptoland: Practical Attacks and No Silver Bullet._ Cryptology ePrint Archive 2025/526, preprint, 2025.
- URL: https://eprint.iacr.org/2025/526
- Relation: WEB3-01과 동일 저자진의 밀접하게 관련된 preprint이므로 독립 연구 두 편으로 중복 집계하지 않는다.

## Citation audit checklist

- [ ] 모든 숫자는 위에 기록한 version의 원문과 일치한다.
- [ ] accepted venue와 preprint를 구분한다.
- [ ] `et al.` 항목은 최종 참고문헌에서 전체 저자로 확장한다.
- [ ] 논문의 주장보다 초록만 강하게 해석하지 않는다.
- [ ] 직접 구현하지 않은 baseline은 `adapted` 또는 `conceptual`로 표시한다.
- [ ] MetaMask 문서의 변경 여부를 final freeze 때 다시 확인한다.
