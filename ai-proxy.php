<?php
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Headers: Content-Type");
header("Content-Type: application/json; charset=UTF-8");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// सुरक्षित तरीके से .env या सर्वर एनवायरनमेंट से की रीड करना
$apiKey = getenv('GEMINI_API_KEY');

// अगर लोकल चला रहे हैं और getenv खाली है, तो डायरेक्ट .env फाइल से पढ़ लेगा
if (empty($apiKey) && file_exists(__DIR__ . '/.env')) {
    $envLines = file(__DIR__ . '/.env', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($envLines as $line) {
        if (strpos(trim($line), '#') === 0) continue;
        $parts = explode('=', $line, 2);
        if (count($parts) === 2) {
            list($name, $value) = $parts;
            if (trim($name) === 'GEMINI_API_KEY') {
                $apiKey = trim($value, "\"' ");
                break;
            }
        }
    }
}

if (empty($apiKey)) {
    echo json_encode(["error" => ["message" => "API key is missing in environment variables or .env file."]]);
    exit();
}

$inputData = json_decode(file_get_contents('php://input'), true);
$promptText = isset($inputData['prompt']) ? $inputData['prompt'] : '';

if (empty($promptText)) {
    echo json_encode(["error" => ["message" => "Prompt text is missing."]]);
    exit();
}

$targetModel = "gemini-1.5-flash";
$apiUrl = "https://generativelanguage.googleapis.com/v1beta/models/{$targetModel}:generateContent?key=" . $apiKey;

$payload = json_encode([
    "contents" => [
        [
            "parts" => [
                ["text" => "You are the smart AI assistant for the owner dashboard of 'Ekta Transport' software. Understand the raw data, ledger, or query provided below and respond cleanly, accurately, and in a professional transport business format:\n\n" . $promptText]
            ]
        ]
    ]
]);

$ch = curl_init($apiUrl);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, "POST");
curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json'
]);

$response = curl_exec($ch);
$err = curl_error($ch);
curl_close($ch);

if ($err) {
    echo json_encode(["error" => ["message" => "Curl Error: " . $err]]);
} else {
    echo $response;
}
?>