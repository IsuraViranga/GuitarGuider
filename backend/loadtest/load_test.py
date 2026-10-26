"""Load test: many students using the app at the same moment.

Each pretend student signs up, then repeats what students do: opens the global songs, opens a
song, checks and saves a practice, opens My progress, with a short pause ("thinking") between
steps. At the end it prints how long each kind of request took and any errors.

    .venv/Scripts/python loadtest/load_test.py --users 500            # your own computer
    .venv/Scripts/python loadtest/load_test.py --base-url https://… --allow-remote --users 50

It only runs against localhost unless --allow-remote is given: it creates real accounts and data,
so point it at the live site only when you mean to (and clean up afterwards).
"""

import argparse
import asyncio
import random
import statistics
import sys
import time
from collections import defaultdict
from urllib.parse import urlparse

import httpx

HEADERS = {"X-Requested-With": "fetch"}


class Stats:
    def __init__(self) -> None:
        self.times: dict[str, list[float]] = defaultdict(list)
        self.errors: dict[str, list[str]] = defaultdict(list)
        self.arrived = 0  # students whose sign-up has finished (or failed)

    async def call(self, name: str, client: httpx.AsyncClient, method: str, url: str, ok: tuple[int, ...] = (200,), **kwargs) -> httpx.Response | None:
        start = time.perf_counter()
        try:
            response = await client.request(method, url, **kwargs)
        except (httpx.HTTPError, OSError) as error:
            self.errors[name].append(type(error).__name__)
            return None
        self.times[name].append(time.perf_counter() - start)
        if response.status_code not in ok:
            self.errors[name].append(str(response.status_code))
            return None
        return response


def percentile(values: list[float], share: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(share * len(ordered)))]


async def student(n: int, args, stats: Stats, run: str, start_gate: asyncio.Event) -> None:
    limits = httpx.Limits(max_connections=2)
    async with httpx.AsyncClient(base_url=args.base_url, headers=HEADERS, timeout=args.timeout, limits=limits) as client:
        # Spread the sign-ups over the ramp-up time, as real students don't all arrive in the same second.
        await asyncio.sleep(random.uniform(0, args.ramp))
        account = {"name": f"Load Student {n}", "email": f"load-{run}-{n}@example.com", "password": "load-test-1"}
        try:
            signed_up = await stats.call("sign up", client, "POST", "/api/auth/signup", ok=(201,), json=account)
        finally:
            stats.arrived += 1
        if signed_up is None:
            return
        await start_gate.wait()
        for _ in range(args.rounds):
            await stats.call("who am I", client, "GET", "/api/auth/me")
            songs = await stats.call("global songs", client, "GET", "/api/songs", params={"scope": "global"})
            if songs is None or not songs.json()["songs"]:
                continue
            await asyncio.sleep(random.uniform(*args.think))
            song_id = random.choice(songs.json()["songs"])["id"]
            song = await stats.call("open a song", client, "GET", f"/api/songs/{song_id}")
            if song is None:
                continue
            await stats.call("saved practice", client, "GET", f"/api/progress/{song_id}", ok=(200, 404))
            await asyncio.sleep(random.uniform(*args.think))
            steps = song.json()["noteCount"]
            record = [{"wrong": [], "result": random.choice(["correct", "correct", "skipped"])} for _ in range(steps)]
            practice = {"mode": "strict", "completed": True, "wrongCount": 0, "bestStreak": steps, "skippedCount": 0, "record": record}
            await stats.call("save practice", client, "PUT", f"/api/progress/{song_id}", json=practice)
            await asyncio.sleep(random.uniform(*args.think))
            await stats.call("my progress", client, "GET", "/api/progress")


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--users", type=int, default=500)
    parser.add_argument("--rounds", type=int, default=3, help="song + save + progress rounds per student")
    parser.add_argument("--ramp", type=float, default=20.0, help="seconds over which the students arrive")
    parser.add_argument("--think", type=float, nargs=2, default=(1.0, 3.0), help="pause between steps, min and max seconds")
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--allow-remote", action="store_true", help="allow a server that is not on this computer")
    args = parser.parse_args()

    if urlparse(args.base_url).hostname not in ("localhost", "127.0.0.1") and not args.allow_remote:
        print("Refusing to load-test a server that is not on this computer. Add --allow-remote if you mean it.")
        return 2

    run = time.strftime("%Y%m%d%H%M%S")
    stats = Stats()
    gate = asyncio.Event()
    print(f"{args.users} students arrive over {args.ramp:.0f} s, then each does {args.rounds} rounds against {args.base_url} …")
    started = time.perf_counter()
    tasks = [asyncio.create_task(student(n, args, stats, run, gate)) for n in range(args.users)]
    await asyncio.sleep(args.ramp)
    # Everyone who has signed up by now starts together: the busiest moment of the test.
    while stats.arrived < args.users:
        await asyncio.sleep(0.2)
    signup_done = time.perf_counter()
    gate.set()
    await asyncio.gather(*tasks)
    finished = time.perf_counter()

    total = sum(len(v) for v in stats.times.values())
    failed = sum(len(v) for v in stats.errors.values())
    print(f"\nSign-ups took {signup_done - started:.1f} s; the practice part {finished - signup_done:.1f} s.")
    print(f"{total} requests answered, {failed} failed ({100 * failed / max(1, total + failed):.2f} %); "
          f"{total / (finished - started):.1f} requests per second on average.\n")
    print(f"{'request':<16}{'count':>7}{'median':>10}{'95 %':>10}{'99 %':>10}{'slowest':>10}  errors")
    for name, values in stats.times.items():
        errors = stats.errors.get(name, [])
        summary = ", ".join(f"{code}×{errors.count(code)}" for code in sorted(set(errors))) or "-"
        print(f"{name:<16}{len(values):>7}{statistics.median(values) * 1000:>8.0f}ms{percentile(values, 0.95) * 1000:>8.0f}ms"
              f"{percentile(values, 0.99) * 1000:>8.0f}ms{max(values) * 1000:>8.0f}ms  {summary}")
    for name in stats.errors.keys() - stats.times.keys():
        print(f"{name:<16}  only errors: {', '.join(stats.errors[name][:5])}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
