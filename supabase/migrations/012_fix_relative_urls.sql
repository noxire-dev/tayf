-- Prefix any relative article URLs with their source's base URL.
-- Also handles image_urls that are relative (fewer, but possible).
update articles a
set url = rtrim(s.url, '/') || a.url
from sources s
where a.source_id = s.id
  and a.url like '/%';

-- Same for image_urls stored as relative
update articles a
set image_url = rtrim(s.url, '/') || a.image_url
from sources s
where a.source_id = s.id
  and a.image_url like '/%';
