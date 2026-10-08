# Guild Tracker

A static website (HTML/CSS/JS, no installation required) that displays rankings, charts, member profiles, and guild standings using CSV files. The interface is in English.

## Pages

- **Rankings**: rankings by power, level, contribution, ATK/DEF/HP/SPD, equipment level, etc. Includes a class filter, name search, and changes since the previous week.
- **Member** (click a name): a member profile showing their class, all their stats compared with the guild median, and their equipment (weapons, techniques, charms).
- **Charts**: member distribution, top 10, members by class, median stats by class, power versus level, and trends over time once two weeks of data are available.
- **Compare**: two members side by side (table, radar chart showing their standing within the guild, and trends over time).
- **Guild**: floor reached, boss damage, guild power and activity, and the standings of the guilds immediately above and below ours.
- **Data**: loaded files, values to check, CSV templates, and file previews before publishing.

## Data files (`data/` folder)

Each week, **append new rows to the end** of each file (without changing the first row). Dates must use the `YYYY-MM-DD` format. Empty cells are allowed.

| File | Contents | Required |
|---|---|---|
| `members.csv` | One row per member per week: `date, member, player_id, role, power, level, contribution, contribution_total, class, class_level, atk, def, hp, spd, weapon, second_hand, helmet, chestplate, boots, technique_1` through `technique_4`, `charm_1` through `charm_4` | Yes |
| `guild.csv` | Three rows per week (the guild above ours, our guild, and the guild below ours): `date, guild, guild_level, members, guild_power, activeness, floor, boss_hp_remaining_pct, relation, rank, ranked_guild, ranked_floor, boss_damage_pct` | No |
| `stats.csv` | `date, member, role, power, level, contribution, event_score` | No |

About `stats.csv`: it never replaces `members.csv`. It adds event scores (the “Event score” stat appears as soon as at least one value is provided; any `event_participation` column in the file is ignored). Every discrepancy with `members.csv` is listed in the **Data** tab. Names are matched across files even if their spelling differs slightly.

## Values to check

When numbers are extracted from screenshots, errors can occur. The website does not correct anything: it displays the values as provided, but flags anything that looks incorrect with a ⚠ (in Rankings, on the member profile, and in the **Data** tab list). These warnings may indicate power that does not match HP, a stat that is 10 times too high or too low, an inconsistent equipment item, a level that has decreased, a name containing an unusual character, or a sum of member power values that differs from the guild’s total power. Correct the CSV and publish again.

## Publish on GitHub Pages

1. Create a GitHub repository (for example, `guild-tracker`) and upload all the contents of this folder.
2. In the repository, go to **Settings → Pages → Build and deployment**, set the source to **Deploy from a branch**, select the `main` branch, and choose the `/ (root)` folder.
3. After about a minute, the website will be live at `https://YOUR-USERNAME.github.io/guild-tracker/`.

## Update each week

On GitHub, open the relevant file in `data/`, click the pencil icon, paste the new rows at the end, then click **Commit changes**. The website will be republished within about a minute. You can check a file first using **Data → Preview a file**: formatting errors identify the row that needs to be corrected.

## Customize

- `js/config.js`: website title and paths to the three files.
- `css/style.css`: colors and typography (variables at the top of the file).

## Test locally

Opening `index.html` directly does not work (the browser blocks access to the CSV files). From this folder, run:

```bash
python3 -m http.server
```

Then open http://localhost:8000.

## Technical notes

- Charts: Chart.js 4 (local file in `vendor/`, no CDN).
- Data series colors have been checked against the dark background for contrast and distinguishability for people with color vision deficiencies.
