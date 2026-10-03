--[[
	Resco Studio plugin.
	Long-polls the local Resco app (127.0.0.1) for commands and executes them
	with Studio APIs: read/write scripts, edit instances, run Luau, playtest.
]]

local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")
local LogService = game:GetService("LogService")
local ScriptEditorService = game:GetService("ScriptEditorService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")

-- Plugins also load inside playtest DataModels; only the edit session talks to Resco.
if RunService:IsRunning() then
	return
end

local VERSION = "0.1.0"
local BRIDGE = "http://127.0.0.1:" .. tostring(plugin:GetSetting("RescoPort") or 47821)
local MAX_TREE_NODES = 2500
local HARNESS_NAME = "__RescoHarness"
local CLIENT_HARNESS_NAME = "__RescoClientHarness"

local toolbar = plugin:CreateToolbar("Resco")
local toggleButton = toolbar:CreateButton("Resco", "Connect Studio to the Resco app", "rbxassetid://4458901886")
toggleButton.ClickableWhenViewportHidden = true

local active = plugin:GetSetting("RescoActive") ~= false
local connected = false

local function log(msg)
	print("[Resco] " .. msg)
end

---------------------------------------------------------------------------
-- Paths & values
---------------------------------------------------------------------------

local DEFAULT_ROOTS = {
	"Workspace",
	"ReplicatedStorage",
	"ReplicatedFirst",
	"ServerScriptService",
	"ServerStorage",
	"StarterGui",
	"StarterPlayer",
	"StarterPack",
	"Lighting",
	"SoundService",
	"Teams",
}

local function splitPath(path)
	local parts = {}
	for segment in string.gmatch(path or "", "[^/]+") do
		table.insert(parts, segment)
	end
	return parts
end

local function resolve(path)
	local parts = splitPath(path)
	local current = game
	for i, name in ipairs(parts) do
		local child
		if i == 1 then
			local ok, service = pcall(game.GetService, game, name)
			child = (ok and service) or game:FindFirstChild(name)
		else
			child = current:FindFirstChild(name)
		end
		if not child then
			return nil, string.format("Instance not found: %s (missing '%s')", path, name)
		end
		current = child
	end
	return current
end

local function mustResolve(path)
	local inst, err = resolve(path)
	if not inst then
		error(err, 0)
	end
	return inst
end

local function pathOf(inst)
	local parts = {}
	local current = inst
	while current and current ~= game do
		table.insert(parts, 1, current.Name)
		current = current.Parent
	end
	return table.concat(parts, "/")
end

local function decodeValue(v)
	if type(v) ~= "table" or v.type == nil then
		return v
	end
	local t, a = v.type, v.value
	if t == "Vector3" then
		return Vector3.new(a[1], a[2], a[3])
	elseif t == "Vector2" then
		return Vector2.new(a[1], a[2])
	elseif t == "Color3" then
		return Color3.new(a[1], a[2], a[3])
	elseif t == "Color3RGB" then
		return Color3.fromRGB(a[1], a[2], a[3])
	elseif t == "UDim" then
		return UDim.new(a[1], a[2])
	elseif t == "UDim2" then
		return UDim2.new(a[1], a[2], a[3], a[4])
	elseif t == "CFrame" then
		return CFrame.new(table.unpack(a))
	elseif t == "BrickColor" then
		return BrickColor.new(a)
	elseif t == "NumberRange" then
		return NumberRange.new(a[1], a[2] or a[1])
	elseif t == "Enum" then
		return Enum[a[1]][a[2]]
	elseif t == "Instance" then
		return mustResolve(a)
	end
	error("Unsupported value type: " .. tostring(t), 0)
end

local function encodeValue(v)
	local t = typeof(v)
	if t == "nil" or t == "boolean" or t == "number" or t == "string" then
		return v
	elseif t == "Instance" then
		return { type = "Instance", value = pathOf(v), className = v.ClassName }
	elseif t == "Vector3" then
		return { type = "Vector3", value = { v.X, v.Y, v.Z } }
	elseif t == "Vector2" then
		return { type = "Vector2", value = { v.X, v.Y } }
	elseif t == "Color3" then
		return { type = "Color3RGB", value = { math.round(v.R * 255), math.round(v.G * 255), math.round(v.B * 255) } }
	elseif t == "UDim2" then
		return { type = "UDim2", value = { v.X.Scale, v.X.Offset, v.Y.Scale, v.Y.Offset } }
	elseif t == "EnumItem" then
		return { type = "Enum", value = { tostring(v.EnumType), v.Name } }
	elseif t == "table" then
		local out = {}
		for k, val in pairs(v) do
			out[tostring(k)] = encodeValue(val)
		end
		return out
	end
	return { type = t, value = tostring(v) }
end

local function applyProperties(inst, properties)
	for key, value in pairs(properties or {}) do
		local ok, err = pcall(function()
			inst[key] = decodeValue(value)
		end)
		if not ok then
			error(string.format("Failed to set %s.%s: %s", inst.ClassName, key, tostring(err)), 0)
		end
	end
end

local function withHistory(name, fn)
	local recording
	pcall(function()
		recording = ChangeHistoryService:TryBeginRecording(name)
	end)
	local ok, result = pcall(fn)
	if recording then
		ChangeHistoryService:FinishRecording(
			recording,
			ok and Enum.FinishRecordingOperation.Commit or Enum.FinishRecordingOperation.Cancel
		)
	end
	if not ok then
		error(result, 0)
	end
	return result
end

---------------------------------------------------------------------------
-- Scripts
---------------------------------------------------------------------------

local function getSource(inst)
	local ok, source = pcall(ScriptEditorService.GetEditorSource, ScriptEditorService, inst)
	if ok then
		return source
	end
	return inst.Source
end

local function setSource(inst, source)
	local ok = pcall(function()
		ScriptEditorService:UpdateSourceAsync(inst, function()
			return source
		end)
	end)
	if not ok then
		inst.Source = source
	end
end

---------------------------------------------------------------------------
-- Commands
---------------------------------------------------------------------------

local COMMON_PROPERTIES = {
	"Name", "ClassName", "Archivable", "Enabled", "Disabled", "RunContext",
	"Position", "Size", "CFrame", "Orientation", "Anchored", "CanCollide", "CanTouch",
	"Transparency", "Color", "Material", "Shape",
	"Value", "Text", "TextColor3", "TextScaled", "Font", "Image",
	"Visible", "BackgroundColor3", "BackgroundTransparency", "AnchorPoint", "ZIndex", "LayoutOrder",
	"ResetOnSpawn", "ZIndexBehavior", "MaxHealth", "Health", "WalkSpeed", "JumpPower",
}

local commands = {}

function commands.get_tree(args)
	local depth = math.clamp(tonumber(args.depth) or 2, 0, 8)
	local count = 0
	local truncated = false

	local function node(inst, remaining)
		count += 1
		local entry = { name = inst.Name, className = inst.ClassName }
		local children = inst:GetChildren()
		if remaining > 0 and count < MAX_TREE_NODES then
			entry.children = {}
			for _, child in ipairs(children) do
				if count >= MAX_TREE_NODES then
					truncated = true
					break
				end
				table.insert(entry.children, node(child, remaining - 1))
			end
		elseif #children > 0 then
			entry.childCount = #children
		end
		return entry
	end

	local roots = {}
	if args.path and args.path ~= "" then
		table.insert(roots, node(mustResolve(args.path), depth))
	else
		for _, name in ipairs(DEFAULT_ROOTS) do
			local ok, service = pcall(game.GetService, game, name)
			if ok and service then
				table.insert(roots, node(service, depth))
			end
		end
	end
	return { roots = roots, truncated = truncated }
end

function commands.get_instance(args)
	local inst = mustResolve(args.path)
	local props = {}
	for _, name in ipairs(COMMON_PROPERTIES) do
		local ok, value = pcall(function()
			return inst[name]
		end)
		if ok then
			props[name] = encodeValue(value)
		end
	end
	return {
		path = pathOf(inst),
		className = inst.ClassName,
		properties = props,
		attributes = encodeValue(inst:GetAttributes()),
		tags = inst:GetTags(),
		childCount = #inst:GetChildren(),
	}
end

function commands.read_script(args)
	local inst = mustResolve(args.path)
	if not inst:IsA("LuaSourceContainer") then
		error(args.path .. " is a " .. inst.ClassName .. ", not a script", 0)
	end
	return { path = pathOf(inst), className = inst.ClassName, source = getSource(inst) }
end

function commands.search_scripts(args)
	local query = tostring(args.query or "")
	local limit = tonumber(args.limit) or 50
	local results = {}
	for _, inst in ipairs(game:GetDescendants()) do
		if #results >= limit then
			break
		end
		local ok, isScript = pcall(function()
			return inst:IsA("LuaSourceContainer")
		end)
		if ok and isScript then
			local okSource, source = pcall(getSource, inst)
			if okSource and string.find(source, query, 1, true) then
				local lines = {}
				local lineNo = 0
				for line in string.gmatch(source .. "\n", "(.-)\n") do
					lineNo += 1
					if string.find(line, query, 1, true) and #lines < 5 then
						table.insert(lines, { line = lineNo, text = string.sub(line, 1, 200) })
					end
				end
				table.insert(results, { path = pathOf(inst), className = inst.ClassName, matches = lines })
			end
		end
	end
	return results
end

function commands.write_script(args)
	return withHistory("Resco: write " .. tostring(args.path), function()
		local inst = resolve(args.path)
		local created = false
		if not inst then
			local parts = splitPath(args.path)
			local name = table.remove(parts)
			local parent = mustResolve(table.concat(parts, "/"))
			inst = Instance.new(args.className or "ModuleScript")
			inst.Name = name
			inst.Parent = parent
			created = true
		elseif not inst:IsA("LuaSourceContainer") then
			error(args.path .. " exists and is a " .. inst.ClassName, 0)
		end
		setSource(inst, args.source or "")
		return { path = pathOf(inst), className = inst.ClassName, created = created }
	end)
end

function commands.create_instance(args)
	return withHistory("Resco: create " .. tostring(args.name), function()
		local parent = mustResolve(args.parentPath)
		local inst = Instance.new(args.className)
		inst.Name = args.name
		applyProperties(inst, args.properties)
		inst.Parent = parent
		return { path = pathOf(inst), className = inst.ClassName }
	end)
end

function commands.set_properties(args)
	return withHistory("Resco: set " .. tostring(args.path), function()
		local inst = mustResolve(args.path)
		applyProperties(inst, args.properties)
		return { path = pathOf(inst) }
	end)
end

function commands.delete_instance(args)
	return withHistory("Resco: delete " .. tostring(args.path), function()
		local inst = mustResolve(args.path)
		if inst.Parent == game then
			error("Refusing to delete a service", 0)
		end
		inst:Destroy()
		return { deleted = args.path }
	end)
end

local function captureLogs(fn)
	local logs = {}
	local conn = LogService.MessageOut:Connect(function(message, messageType)
		if #logs < 300 then
			table.insert(logs, { message = message, type = messageType.Name })
		end
	end)
	local ok, result = pcall(fn)
	task.wait()
	conn:Disconnect()
	return ok, result, logs
end

function commands.run_luau(args)
	local module = Instance.new("ModuleScript")
	module.Name = "RescoExec"
	module.Source = "return function()\n" .. tostring(args.code or "") .. "\nend"

	local ok, result, logs = captureLogs(function()
		return withHistory("Resco: run Luau", function()
			return require(module)()
		end)
	end)
	module:Destroy()
	if not ok then
		return { ok = false, error = tostring(result), output = logs }
	end
	return { ok = true, result = encodeValue(result), output = logs }
end

function commands.get_output(args)
	local limit = tonumber(args.limit) or 100
	local history = LogService:GetLogHistory()
	local out = {}
	for i = math.max(1, #history - limit + 1), #history do
		local entry = history[i]
		table.insert(out, { message = entry.message, type = entry.messageType.Name })
	end
	return out
end

---------------------------------------------------------------------------
-- Playtest
---------------------------------------------------------------------------

local SERVER_HARNESS = [[
local StudioTestService = game:GetService("StudioTestService")
local LogService = game:GetService("LogService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local started = os.clock()
local duration = script:GetAttribute("Duration") or 6
local serverLogs, clientLogs, checks = {}, {}, {}

LogService.MessageOut:Connect(function(message, messageType)
	if #serverLogs < 400 and not string.find(message, "__Resco", 1, true) then
		table.insert(serverLogs, { message = message, type = messageType.Name, t = os.clock() - started })
	end
end)

local remote = Instance.new("RemoteEvent")
remote.Name = "__RescoLog"
remote.Parent = ReplicatedStorage
remote.OnServerEvent:Connect(function(_, message, messageType)
	if #clientLogs < 400 then
		table.insert(clientLogs, { message = tostring(message), type = tostring(messageType), t = os.clock() - started })
	end
end)

local t = {}
function t.check(name, condition, detail)
	table.insert(checks, { name = tostring(name), passed = condition and true or false, detail = detail ~= nil and tostring(detail) or nil })
end
function t.wait(seconds)
	return task.wait(seconds)
end
function t.waitForPlayer(timeout)
	local deadline = os.clock() + (timeout or 15)
	while #Players:GetPlayers() == 0 and os.clock() < deadline do
		task.wait(0.1)
	end
	return Players:GetPlayers()[1]
end

local testError
local testModule = script:FindFirstChild("TestCode")
if testModule then
	local okRequire, fn = pcall(require, testModule)
	if okRequire then
		local okRun, err = pcall(fn, t)
		if not okRun then
			testError = tostring(err)
		end
	else
		testError = "testCode failed to compile: " .. tostring(fn)
	end
end

local remaining = duration - (os.clock() - started)
if remaining > 0 then
	task.wait(remaining)
end
task.wait(0.25)

StudioTestService:EndTest({
	serverLogs = serverLogs,
	clientLogs = clientLogs,
	checks = checks,
	testError = testError,
	elapsed = os.clock() - started,
})
]]

local CLIENT_HARNESS = [[
local LogService = game:GetService("LogService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local remote = ReplicatedStorage:WaitForChild("__RescoLog", 15)
if not remote then return end
LogService.MessageOut:Connect(function(message, messageType)
	if not string.find(message, "__Resco", 1, true) then
		remote:FireServer(message, messageType.Name)
	end
end)
]]

local function countErrors(logs)
	local errors = {}
	for _, entry in ipairs(logs or {}) do
		if entry.type == "MessageError" then
			table.insert(errors, entry.message)
		end
	end
	return errors
end

function commands.playtest(args)
	local StudioTestService = game:GetService("StudioTestService")
	local ServerScriptService = game:GetService("ServerScriptService")
	local StarterPlayerScripts = game:GetService("StarterPlayer"):FindFirstChildOfClass("StarterPlayerScripts")

	local server = Instance.new("Script")
	server.Name = HARNESS_NAME
	server.Source = SERVER_HARNESS
	server:SetAttribute("Duration", math.clamp(tonumber(args.durationSec) or 6, 1, 120))
	if args.testCode and args.testCode ~= "" then
		local testModule = Instance.new("ModuleScript")
		testModule.Name = "TestCode"
		testModule.Source = "return function(t)\n" .. args.testCode .. "\nend"
		testModule.Parent = server
	end

	local client = Instance.new("LocalScript")
	client.Name = CLIENT_HARNESS_NAME
	client.Source = CLIENT_HARNESS

	server.Parent = ServerScriptService
	if StarterPlayerScripts then
		client.Parent = StarterPlayerScripts
	end

	local ok, result = pcall(function()
		return StudioTestService:ExecutePlayModeAsync({})
	end)

	server:Destroy()
	client:Destroy()

	if not ok then
		return { passed = false, error = "Could not run playtest: " .. tostring(result) }
	end
	result = result or {}

	local serverErrors = countErrors(result.serverLogs)
	local clientErrors = countErrors(result.clientLogs)
	local failedChecks = {}
	for _, check in ipairs(result.checks or {}) do
		if not check.passed then
			table.insert(failedChecks, check)
		end
	end
	local passed = result.testError == nil and #serverErrors == 0 and #clientErrors == 0 and #failedChecks == 0

	return {
		passed = passed,
		testError = result.testError,
		serverErrors = serverErrors,
		clientErrors = clientErrors,
		failedChecks = failedChecks,
		checks = result.checks,
		serverLogs = result.serverLogs,
		clientLogs = result.clientLogs,
		elapsed = result.elapsed,
	}
end

---------------------------------------------------------------------------
-- Bridge loop
---------------------------------------------------------------------------

local function request(method, path, body)
	return HttpService:RequestAsync({
		Url = BRIDGE .. path,
		Method = method,
		Headers = { ["Content-Type"] = "application/json" },
		Body = body and HttpService:JSONEncode(body) or nil,
	})
end

local function handle(req)
	local handler = commands[req.command]
	if not handler then
		return false, "Unknown command: " .. tostring(req.command)
	end
	local ok, result = xpcall(handler, function(err)
		return tostring(err)
	end, req.args or {})
	return ok, result
end

local function setConnected(value)
	if value ~= connected then
		connected = value
		log(value and "Connected to Resco" or "Waiting for the Resco app on " .. BRIDGE)
	end
end

local loopId = 0
local function startLoop()
	loopId += 1
	local myId = loopId
	task.spawn(function()
		local backoff = 0.5
		local helloSent = false
		while active and myId == loopId do
			local ok, res = pcall(request, "GET", "/poll")
			if ok and res.Success then
				backoff = 0.5
				setConnected(true)
				if not helloSent then
					helloSent = pcall(request, "POST", "/hello", {
						placeName = game.Name,
						placeId = game.PlaceId,
						pluginVersion = VERSION,
					})
				end
				local okDecode, data = pcall(HttpService.JSONDecode, HttpService, res.Body)
				if okDecode and data and data.request then
					local req = data.request
					local success, result = handle(req)
					local payload = { id = req.id, ok = success }
					if success then
						payload.result = result
					else
						payload.error = result
					end
					local okSend, sendErr = pcall(request, "POST", "/response", payload)
					if not okSend then
						pcall(request, "POST", "/response", { id = req.id, ok = false, error = "Failed to send result: " .. tostring(sendErr) })
					end
				end
			else
				setConnected(false)
				helloSent = false
				task.wait(backoff)
				backoff = math.min(backoff * 2, 5)
			end
		end
	end)
end

toggleButton:SetActive(active)
toggleButton.Click:Connect(function()
	active = not active
	plugin:SetSetting("RescoActive", active)
	toggleButton:SetActive(active)
	if active then
		startLoop()
	else
		setConnected(false)
		log("Disabled")
	end
end)

plugin.Unloading:Connect(function()
	active = false
end)

if active then
	startLoop()
end
