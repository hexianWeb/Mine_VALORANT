"""豪气试炼：可重复的普通/甲靶对照实验。Python 3.8+，仅标准库。

python simulate.py --runs 200 --seed 17
python simulate.py --audit --runs 200 --seed 17
python simulate.py --csv trials.csv  # 每个样本，不是汇总
常数出处及未建模因素见同目录 README、balance.md。时间单位：有效游戏秒。
"""

import argparse
import csv
import math
import random
import statistics as st
from collections import Counter


# 假设：转靶/手射间隔/命中率/命中后头率/命中后腿率/每批确认时间。
PROFILES = {
    "novice": (1.10, .34, .58, .16, .16, .75),
    "trained": (.72, .24, .76, .32, .10, .50),
    "expert": (.48, .17, .89, .53, .06, .37),
}
# 本地 Vandal 配置；纯手动和辅助共用一个供弹和射速时钟。
HEAD, BODY, LEG = 160, 40, 34
INTERVAL, CAP, RELOAD = 1 / 9.75, 25, 2.5
# 假设：受控的逐场护甲率；三选一的一条条件路径，不代表实际发牌概率。
ARMOR = (0, .25, .40, .50, .60)
PATH = ("base", "precision", "reload", "supply")


def percentile(values, p):
    if not values:
        return None
    seq = sorted(values)
    k = (len(seq) - 1) * p
    f = int(k)
    right = seq[min(f + 1, len(seq) - 1)]
    if k == f or right == seq[f]:
        return seq[f]
    return seq[f] + (right - seq[f]) * (k - f)


def simulate(profile, stage, seed, layers=None, v2=False, seconds=90,
             threshold=None, plain=False, armored=None, dense=False, visible=2, refund=1):
    assert stage in range(1, 6) and seconds > 0
    s = Counter(layers or {})
    aim, tap, hit_rate, head_rate, leg_rate, confirm = PROFILES[profile]
    # 按用途拆 RNG，改变射速不会把护甲随机数拿去算命中。
    aim_rng, shot_rng, armor_rng = [random.Random(seed * 11 + n) for n in (1, 2, 3)]
    jitter = lambda mean: aim_rng.uniform(.8, 1.2) * mean
    armor_p = ARMOR[stage - 1] if armored is None else armored
    life = lambda: 100 + 50 * (armor_rng.random() < armor_p)
    limit = threshold if threshold is not None else (
        300 + 75 * (stage - 1) if v2 else 180 + 10 * (stage - 1))
    q = .97 - .17 * .7 ** s["ext"]
    retained = .9 * (1 - (5 / 6) ** s["retain"])
    base = (5 + s["base"]) * ((1 + s["glass"]) if v2 else
                               (1 + .6 * (1 - .5 ** s["glass"])))
    batch_size = 5 if dense else visible  # 假设：每批可见数，非锁定槽上限
    assert 1 <= batch_size <= 5 and refund >= 0
    lock = .15 / (1 + .2 * s["fast"])
    slew = .10 / (1 + .2 * s["fast"])
    reload_time = RELOAD / (1 + .30 * s["reload"])
    charge = .60 * limit if stage == 1 and not v2 else 0.
    cents = 0
    mult, ammo, hp = 100, CAP, life()
    target_armored = hp > 100
    manual = guided = n = batch = misses = shots = clips = manual_heads = 0
    first = start = end = None
    durations = []
    ready, intent = 0., jitter(aim)
    fresh = True
    while True:
        t = max(intent, ready)
        if end is not None and end <= min(t, seconds):
            durations.append(end - start)
            charge = limit * retained
            if not v2:
                mult = 100
            intent, start, end = end + jitter(aim), None, None
            continue
        if t >= seconds:
            if end is not None:
                durations.append(seconds - start)
                clips = 1
            break
        flow = end is not None
        shots += 1
        ammo -= 1
        ready = t + INTERVAL
        hit = flow or shot_rng.random() < hit_rate
        head = False
        dmg = 0
        if hit:
            zone = 0 if flow else shot_rng.random()
            head = zone < head_rate
            dmg = HEAD if head else LEG if zone >= 1 - leg_rate else BODY
            if not flow or v2:
                mult = min(300 + 100 * s["cap"], mult + 10)
        else:
            misses += 1
            mult = max(100, mult // 2)
            charge = max(0., charge - (10 if v2 else 2) * s["glass"])
        hp -= dmg
        killed = hp <= 0
        if killed:
            cents += (2 if head else 1) * mult + (200 * s["harvest"] if flow else 0)
            if flow:
                bonus = .2 * s["merge"] if v2 else .2 * s["merge"] * q ** n
                end += .5 * q ** n + (bonus if head else 0)
                guided += 1
                n += 1
                batch -= 1
            else:
                manual += 1
                manual_heads += int(head)
                charge += ((10 if head else 6) + 2 * target_armored) * mult / 100 * (
                    1 + s["precision"] * (fresh and head))
            if v2 or not flow:
                ammo = min(CAP, ammo + refund * s["supply"])
            hp = life()
            fresh = True
        else:
            fresh = False
        if killed:
            target_armored = hp > 100
        if ammo == 0:
            # 立即开始空仓换弹；若心流中途结束，ready 保留承诺的恢复时间。
            ready = max(ready, t + reload_time)
            ammo = CAP
        if flow:
            if killed and batch == 0:
                batch = batch_size
                intent = t + lock + jitter(confirm) + (0 if dense else jitter(aim))
            else:
                intent = t + (slew if killed else INTERVAL)
        elif not plain and charge >= limit:
            first = t if first is None else first
            start, end, n, batch, charge = t, t + base, 0, batch_size, 0.
            intent = t + lock + jitter(confirm)
        else:
            intent = t + jitter(aim if killed else tap)
    return dict(manual=manual, guided=guided, kpm=(manual + guided) * 60 / seconds,
                first=first, times=durations, clipped=clips, coins=cents // 100,
                shots=shots, misses=misses, manual_heads=manual_heads)


def fmt(x):
    return "-" if x is None else "%.2f" % x


def samples(profile, stage, args, layers, **opts):
    return [simulate(profile, stage, args.seed + i, layers, **opts) for i in range(args.runs)]


def run(args, writer):
    print("profile stage flow/game duration_p10/p50/p90_s (observed) clipped/episodes"
          " first_p50_s none/games KPM manual_kill_share")
    for profile in PROFILES:
        for stage in range(1, 6):
            rows = samples(profile, stage, args, PATH[:stage - 1])
            times = [d for row in rows for d in row["times"]]
            firsts = [r["first"] for r in rows if r["first"] is not None]
            k = sum(r["manual"] + r["guided"] for r in rows)
            print(profile, stage, fmt(len(times) / len(rows)),
                  "/".join(fmt(percentile(times, p)) for p in (.1, .5, .9)),
                  "%d/%d" % (sum(r["clipped"] for r in rows), len(times)),
                  fmt(percentile(firsts, .5)), "%d/%d" % (len(rows) - len(firsts), len(rows)),
                  fmt(st.mean(r["kpm"] for r in rows)), fmt(sum(r["manual"] for r in rows) / k) if k else "-")
            if writer:
                for i, r in enumerate(rows):
                    writer.writerow([profile, stage, args.seed + i, r["first"], len(r["times"]),
                                     "|".join(fmt(d) for d in r["times"]), r["clipped"], r["kpm"],
                                     r["manual"], r["guided"], r["coins"], r["shots"], r["misses"]])


def audit(args):
    print("Manual-only input check: KPM / lethal head share / missed shots (hypotheses)")
    for profile in PROFILES:
        base = samples(profile, 1, args, {}, plain=True)
        print(profile, fmt(st.mean(r["kpm"] for r in base)),
              fmt(sum(r["manual_heads"] for r in base) / sum(r["manual"] for r in base)),
              fmt(sum(r["misses"] for r in base) / sum(r["shots"] for r in base)))
    print("G2: median player manual share S1/S4; G3: median paired S4/S1 KPM")
    for profile in PROFILES:
        a = samples(profile, 1, args, {})
        b = samples(profile, 4, args, PATH[:3])
        print(profile, *(fmt(st.median(r["manual"] / (r["manual"] + r["guided"]) for r in group))
                         for group in (a, b)),
              fmt(st.median(v["kpm"] / u["kpm"] for u, v in zip(a, b))))
    print("One-factor S4 diagnosis: third pick=supply, base+precision fixed."
          " profile variant / median manual share / median paired S4:S1 KPM")
    for profile in ("trained", "expert"):
        first = samples(profile, 1, args, {})
        for name, opts in (("control", {}), ("refund2", {"refund": 2}), ("one_visible", {"visible": 1})):
            rows = samples(profile, 4, args, ("base", "precision", "supply"), **opts)
            print(profile, name, fmt(st.median(r["manual"] / (r["manual"] + r["guided"]) for r in rows)),
                  fmt(st.median(r["kpm"] / a["kpm"] for r, a in zip(rows, first))))
    print("Single-card A/B: paired change in total KPM%, coins% vs empty;"
          " stage 3, identical threshold 200, same seeds, trained. v2=raw|v3=revised.")
    for raw in (True, False):
        base = samples("trained", 3, args, {}, v2=raw, threshold=200)
        for key in ("base", "ext", "retain", "fast", "merge", "glass", "supply",
                    "precision", "reload", "cap", "harvest"):
            rows = samples("trained", 3, args, {key: 1}, v2=raw, threshold=200)
            effects = [100 * sum(r[k] - b[k] for r, b in zip(rows, base)) /
                       sum(b[k] for b in base) for k in ("kpm", "coins")]
            print("v2" if raw else "v3", key, *(fmt(x) for x in effects))
    print("First-stage novice: H/v2 flag, first time p50 (non-entry=inf), fraction by 25s")
    for h, raw in ((150, False), (180, False), (210, False), (300, True)):
        rows = samples("novice", 1, args, {}, threshold=h, v2=raw)
        f = [r["first"] if r["first"] is not None else math.inf for r in rows]
        print(h, raw, fmt(percentile(f, .5)), fmt(sum(t <= 25 for t in f) / len(f)))
    print("Stress: raw vs revised expert, 4 picks: merge x2 + supply + ext,"
          " stage 5, dense sightlines, common threshold 220. mean KPM / guided share / observed duration p90")
    for raw in (True, False):
        rows = samples("expert", 5, args, {"merge": 2, "supply": 1, "ext": 1},
                       threshold=220, v2=raw, dense=True)
        print("v2" if raw else "v3", fmt(st.mean(r["kpm"] for r in rows)),
              fmt(sum(r["guided"] for r in rows) / sum(r["manual"] + r["guided"] for r in rows)),
              fmt(percentile([d for r in rows for d in r["times"]], .9)))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--runs", type=int, default=200)
    p.add_argument("--seed", type=int, default=17)
    p.add_argument("--csv", help="optional per-trial CSV output")
    p.add_argument("--audit", action="store_true")
    args = p.parse_args()
    if args.runs < 1:
        p.error("--runs must be positive")
    if args.csv:
        with open(args.csv, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow("profile stage seed first_s flows durations_s last_clipped kpm manual guided coins shots misses".split())
            run(args, writer)
    else:
        run(args, None)
    if args.audit:
        audit(args)


if __name__ == "__main__":
    main()
