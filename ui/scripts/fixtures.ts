// 사용자의 실제 워크플로우에서 가져온 프롬프트 — 긴 프롬프트(77토큰 초과)의
// 인코딩 경로까지 동일성 검증에 포함시키기 위해 실데이터를 사용한다.
// (검증은 양쪽에 같은 문자열을 쓰므로 원본과의 공백 차이는 결과에 무관)

export const POSITIVE = `year 2025, Exceptional quality that stands out as a truly outstanding illustration. (score_9, score_8, score_7:1.1), highres, absurdres, This illustration has a very good overall feeling and detailed expression and is an excellent artwork painting. Illustrations with well-proportioned figures. This illustration exhibits masterful body proportions and a variety of intricate features that are truly commendable.

(@gomennasai:0.8), (@henriiku (ahemaru):0.8), (@freng:1.2),

cel shading, squishy skin,

1girl, hair over one eye, shark girl, shark tail, shark tooth, dark blue hair, wolf cut, grey eyes, sports swimsuit, shy, angry, full face blush, punching,`

export const NEGATIVE = `worst quality, (worst aesthetic:1.1), bad quality, (score_1, score_2, score_3, score_4, score_5:1.2), lowres, bad anatomy, (artistic error:1.1), (bad:.1.1), off-topic, multiple views, comic, extra digits, fewer digits, fewer, error, missing, jpeg artifacts, artist name, signature, twitter username, username, logo, watermark, scan, unfinished, variations, bad hands, pink pupils, empty eyes, This is an unnatural and strange illustration. This is an ugly and subpar illustration.

heavy shadow, deep shading, harsh contrast, censored,`
