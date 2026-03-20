# Clip Test Cases

Ground truth for evaluating clip boundary detection. Timestamps are relative to the app's audio (RSS feed), not Spotify. Spotify timestamps included for cross-reference (typically ~30s offset due to Spotify ads/intro).

---

## Test Case 1: BCI / AI (TWIST)

- **Episode:** Are Brain-Computer Interfaces Actually Ready for Humans?
- **Podcast:** This Week in Startups
- **Topic:** AI
- **Current result:** 4:56–7:35 (159s)
- **Ideal start:** ~5:36 (TBD — user still refining)
- **Ideal end:** ~7:39 (TBD — user still refining)
- **Notes:** Core discussion is about how AI/language models are used in BCI to decode neural signals into speech. Host asks "Is this a place where modern AI tools have increased the pace..." and guest explains language models for thought-to-text. START is close now (4:56), END drags ~48s past ideal.

---

## Test Case 2: LeBron / Rollicking Mailbag (BS Pod) — existing clip

- **Episode:** A Rollicking NBA Mailbag and March Madness Storylines With Rob Mahoney, Tate Frazier, and J. Kyle Mann
- **Podcast:** The Bill Simmons Podcast
- **Topic:** lebron
- **Current result:** 50:01–54:42
- **Ideal start:** 50:25 ("See, Rob Mahoney, that's why you're the best. Uh, two more and then we're done.")
- **Ideal end:** 54:50 ("…All right, Rob Mahoney, you can listen to him tomorrow")
- **Spotify equivalent:** 49:55–54:20
- **Notes:** Not a huge miss. Start is 24s early, end is 8s early.

---

## Test Case 3: LeBron / Rollicking Mailbag (BS Pod) — proposed new clip (MISSED)

- **Episode:** A Rollicking NBA Mailbag and March Madness Storylines With Rob Mahoney, Tate Frazier, and J. Kyle Mann
- **Podcast:** The Bill Simmons Podcast
- **Topic:** lebron
- **Should qualify:** YES
- **Currently detected:** NO — system only found 1 LeBron clip (Test Case 2). This is a recall miss.
- **Ideal start:** 5:43 ("And he, I think he can figure it out more consistently…")
- **Ideal end:** 7:34 ("…Yeah. I just wonder like, yeah, maybe they could win 2 rounds. I don't know")
- **Spotify equivalent:** 5:13–7:04
- **Notes:** GPT-proposed. User agrees this should qualify. Sustained LeBron discussion that the system failed to find. Likely filtered by similarity threshold, segment labeling, or LLM verification.

---

## Test Case 4: LeBron / Rollicking Mailbag (BS Pod) — proposed, should NOT qualify

- **Episode:** A Rollicking NBA Mailbag and March Madness Storylines With Rob Mahoney, Tate Frazier, and J. Kyle Mann
- **Podcast:** The Bill Simmons Podcast
- **Topic:** lebron
- **Should qualify:** NO — just a quick thought, not sustained discussion
- **Ideal start:** 16:25 ("Like these were like the two icons of the league along with Magic, you know?")
- **Ideal end:** 16:58 ("…Maybe you haven't had one yet.")
- **Spotify equivalent:** 15:55–16:28
- **Notes:** 33 seconds total. Too brief to be a real clip.

---

## Test Case 5: LeBron / Rollicking Mailbag (BS Pod) — proposed, borderline

- **Episode:** A Rollicking NBA Mailbag and March Madness Storylines With Rob Mahoney, Tate Frazier, and J. Kyle Mann
- **Podcast:** The Bill Simmons Podcast
- **Topic:** lebron
- **Should qualify:** BORDERLINE (leaning no)
- **Ideal start:** 17:48 ("So Joe Robinson sent a two-part question based…")
- **Ideal end:** 18:23 ("…but those 5 guys seem like the right guys.")
- **Spotify equivalent:** 17:18–17:53
- **Notes:** 35 seconds. Interesting tidbit that could trigger emotional reaction for LeBron fans, but not critical. Gun to head = no.

---

*More test cases coming...*
