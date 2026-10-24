# Instructor song library

Every `.txt` or `.tab` file in this folder automatically becomes a built-in song in the app.

## How to add a song

1. Create a new file here, e.g. `my-song.txt`. Use English letters, numbers and `-` in the **file name**
   (it becomes part of the song's web address). The **title** inside the file can be in Sinhala.
2. Save it as **UTF-8** (VS Code does this by default).
3. Write the song in guitar numbers (or ASCII tab, see `docs/song-formats.md`):

   ```
   title: ගීතයේ නම
   description: Arranged by <instructor name>
   difficulty: beginner
   # one line per phrase is easiest to read; "|" separates measures
   10 11 13 11 | 10 23 21
   ```

   A song sheet with the words under each numbers line also works (see `twinkle-twinkle.txt`):
   each word or syllable belongs to the number above it, counted in order.

4. Run `npm test` from the `frontend` folder. The test "every library file is valid" names the file,
   line and column of any mistake.
5. The song appears in the app's Songs list (refresh the page if the app is open).

## Copyright

Only add songs you have the right to use: your own exercises and arrangements, traditional songs, or
songs you have permission to teach. This folder ships with the app, so everyone who uses the app can see these songs.
