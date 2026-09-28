#!/bin/zsh
cd "${0:A:h}" || exit 1
/usr/bin/python3 refresh.py
news_result=$?
/usr/bin/python3 archive.py
archive_result=$?
echo
if [[ $news_result -eq 0 && $archive_result -eq 0 ]]; then
  echo "Open index.html to view the new snapshot."
else
  echo "A retrieval failed. Previous successful snapshots remain available. Read the error above."
fi
read "?Press Return to close this window."
if [[ $news_result -ne 0 || $archive_result -ne 0 ]]; then exit 1; fi
exit 0
