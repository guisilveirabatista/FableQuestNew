-- Builds knight.aseprite (tagged, ping-pong walk cycles) and per-direction
-- animated GIF previews from the 72x128 charset PNG.
-- Run:  aseprite -b --script-param sheet=assets/knight.png \
--         --script-param out=tools --script tools/aseprite_preview.lua
local sheetPath = app.params["sheet"]
local outDir = app.params["out"]
local src = Image{ fromFile = sheetPath }
local dirs = { "up", "right", "down", "left" }

local function setCel(spr, f, img)
  local ok = pcall(function() spr:newCel(spr.layers[1], f, img, Point(0, 0)) end)
  if not ok then spr.layers[1]:cel(f).image = img end
end

local function frameImage(col, row)
  local img = Image(24, 32, ColorMode.RGB)
  img:drawImage(src, Point(-col * 24, -row * 32))
  return img
end

-- tagged .aseprite with all 12 frames
local spr = Sprite(24, 32, ColorMode.RGB)
while #spr.frames < 12 do spr:newEmptyFrame() end
for f = 1, 12 do
  spr.frames[f].duration = 0.15
  setCel(spr, f, frameImage((f - 1) % 3, math.floor((f - 1) / 3)))
end
for i, name in ipairs(dirs) do
  local tag = spr:newTag((i - 1) * 3 + 1, (i - 1) * 3 + 3)
  tag.name = name
  tag.aniDir = AniDir.PING_PONG
end
spr:saveAs(outDir .. "/knight.aseprite")

-- 6x animated GIF per direction (frame order 0,1,2,1)
for i, name in ipairs(dirs) do
  local gspr = Sprite(24, 32, ColorMode.RGB)
  while #gspr.frames < 4 do gspr:newEmptyFrame() end
  local seq = { 0, 1, 2, 1 }
  for f = 1, 4 do
    gspr.frames[f].duration = 0.16
    setCel(gspr, f, frameImage(seq[f], i - 1))
  end
  app.activeSprite = gspr
  pcall(function()
    app.command.SpriteSize{ ui = false, scaleX = 6, scaleY = 6, method = "nearest" }
  end)
  gspr:saveCopyAs(outDir .. "/previews/knight_" .. name .. ".gif")
  gspr:close()
end
print("aseprite export done")
